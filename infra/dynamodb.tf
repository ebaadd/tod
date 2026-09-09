# On-demand billing: no throughput is provisioned, so an idle table costs
# nothing beyond the bytes it stores.
resource "aws_dynamodb_table" "main" {
  name         = "${var.name}-submissions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "hpk"
    type = "S"
  }

  attribute {
    name = "hsk"
    type = "S"
  }

  global_secondary_index {
    name            = "history"
    hash_key        = "hpk"
    range_key       = "hsk"
    projection_type = "ALL"
  }

  # Expires submissions at the retention horizon at no charge.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Drives grouping. NEW_IMAGE carries the whole submission, so the handler
  # needs no follow-up read.
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  point_in_time_recovery { enabled = true }

  lifecycle {
    prevent_destroy = true
  }
}
