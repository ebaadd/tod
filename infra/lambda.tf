resource "aws_ecr_repository" "api" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

# Old image versions accumulate silently and bill for storage.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 most recent images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

locals {
  # Two images from one Dockerfile. The API image stays small so its cold
  # start is short; the grouping image carries the embedding model, and its
  # cold start does not matter because nobody is waiting on it.
  image_api      = "${aws_ecr_repository.api.repository_url}:${var.image_tag}-api"
  image_grouping = "${aws_ecr_repository.api.repository_url}:${var.image_tag}-grouping"

  common_env = {
    # Deliberately a variable, not a reference to the distribution: the
    # distribution depends on the function URL, so reading its domain here
    # would make the graph circular. See variables.tf.
    WEB_ORIGIN      = var.web_origin != "" ? var.web_origin : "https://origin-not-set.invalid"
    DATABASE_URL    = local.database_url
    DYNAMODB_TABLE  = aws_dynamodb_table.main.name
    COOKIE_SECURE   = "true"
    RETENTION_DAYS  = tostring(var.retention_days)
    SESSION_DAYS    = tostring(var.session_days)
    PG_CA_BUNDLE    = "/opt/rds-ca.pem"
    PG_POOL_MAX     = "2"
  }
}

# ---------------------------------------------------------------- IAM ----
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "table_access" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query"
    ]
    resources = [
      aws_dynamodb_table.main.arn,
      "${aws_dynamodb_table.main.arn}/index/*"
    ]
  }
}

# Deliberately excludes CreateTable and UpdateTimeToLive. Schema changes are
# a deploy-time action, not something a function serving public traffic can do.
resource "aws_iam_role" "api" {
  name               = "${var.name}-api"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy" "api_table" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.table_access.json
}

resource "aws_iam_role_policy_attachment" "api_vpc" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role" "grouping" {
  name               = "${var.name}-grouping"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "stream_access" {
  statement {
    actions = [
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:ListStreams"
    ]
    resources = [aws_dynamodb_table.main.stream_arn]
  }
}

resource "aws_iam_role_policy" "grouping_stream" {
  role   = aws_iam_role.grouping.id
  policy = data.aws_iam_policy_document.stream_access.json
}

resource "aws_iam_role_policy_attachment" "grouping_vpc" {
  role       = aws_iam_role.grouping.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role" "migrate" {
  name               = "${var.name}-migrate"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "migrate_vpc" {
  role       = aws_iam_role.migrate.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ------------------------------------------------------------ logging ----
# Created explicitly. A log group Lambda makes for itself never expires, and
# log storage is a slow, silent leak.
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "grouping" {
  name              = "/aws/lambda/${var.name}-grouping"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/aws/lambda/${var.name}-migrate"
  retention_in_days = 14
}

# ---------------------------------------------------------- functions ----
resource "random_password" "edge_secret" {
  length  = 48
  special = false
}

resource "aws_lambda_function" "api" {
  function_name = "${var.name}-api"
  role          = aws_iam_role.api.arn
  package_type  = "Image"
  image_uri     = local.image_api
  architectures = ["arm64"]

  # Argon2id is memory-hard by design. Below about 1 GB the CPU share is thin
  # enough that signup and login take seconds.
  memory_size = 1024
  timeout     = 15

  reserved_concurrent_executions = var.api_reserved_concurrency

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = merge(local.common_env, {
      EDGE_SECRET = random_password.edge_secret.result
    })
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function" "grouping" {
  function_name = "${var.name}-grouping"
  role          = aws_iam_role.grouping.arn
  package_type  = "Image"
  image_uri     = local.image_grouping
  image_config { command = ["grouping.handler"] }
  architectures = ["arm64"]

  # The embedding model needs headroom, and Lambda scales CPU with memory, so
  # more memory finishes sooner and can cost the same or less.
  memory_size = 3008
  timeout     = 120

  # Grouping is asynchronous. Capping it keeps a spike from opening more
  # PostgreSQL connections than the cluster will accept.
  reserved_concurrent_executions = 2

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = merge(local.common_env, {
      EMBEDDING_PROVIDER         = "local"
      MODEL_CACHE_DIR            = "/opt/models"
      GROUP_SIMILARITY_THRESHOLD = "0.62"
    })
  }

  depends_on = [aws_cloudwatch_log_group.grouping]
}

# Same image, different command. Invoked by hand after a schema change.
resource "aws_lambda_function" "migrate" {
  function_name = "${var.name}-migrate"
  role          = aws_iam_role.migrate.arn
  package_type  = "Image"
  image_uri     = local.image_api
  image_config { command = ["migrate.handler"] }
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 300

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment { variables = local.common_env }

  depends_on = [aws_cloudwatch_log_group.migrate]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
}

# The filter matters for cost as well as correctness: without it every write
# to the table, including username directory entries, would wake the grouping
# function and its embedding model.
resource "aws_lambda_event_source_mapping" "grouping" {
  event_source_arn  = aws_dynamodb_table.main.stream_arn
  function_name     = aws_lambda_function.grouping.arn
  starting_position = "LATEST"

  batch_size                         = 25
  maximum_batching_window_in_seconds = 20
  maximum_retry_attempts             = 3
  bisect_batch_on_function_error     = true
  function_response_types            = ["ReportBatchItemFailures"]

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["INSERT"]
        dynamodb  = { NewImage = { pk = { S = [{ prefix = "OWNER#" }] } } }
      })
    }
  }
}
