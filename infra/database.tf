# Aurora Serverless v2 with a floor of 0 ACU. The cluster pauses after the
# idle window and compute stops billing; only storage remains, which for a
# database this size is cents per month.
#
# The trade-off is a resume of roughly 10-15 seconds on the first query after
# a pause. That is survivable here only because the anonymous visitor path
# never touches PostgreSQL -- see directory.ts. Owners hitting a cold cluster
# wait; visitors submitting truths and dares do not.

resource "random_password" "database" {
  length  = 40
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_rds_cluster" "main" {
  cluster_identifier = "${var.name}-postgres"
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = var.aurora_engine_version

  database_name   = "tod"
  master_username = "tod"
  master_password = random_password.database.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]

  storage_encrypted   = true
  deletion_protection = true

  backup_retention_period   = 7
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  serverlessv2_scaling_configuration {
    min_capacity             = 0
    max_capacity             = var.aurora_max_acu
    seconds_until_auto_pause = 300
  }

  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }
}

resource "aws_rds_cluster_instance" "main" {
  identifier         = "${var.name}-postgres-1"
  cluster_identifier = aws_rds_cluster.main.id
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version
  instance_class     = "db.serverless"

  # Performance Insights issues background queries that keep the cluster
  # awake, which defeats scaling to zero.
  performance_insights_enabled = false
}

locals {
  database_url = format(
    "postgres://%s:%s@%s:%s/%s",
    aws_rds_cluster.main.master_username,
    random_password.database.result,
    aws_rds_cluster.main.endpoint,
    aws_rds_cluster.main.port,
    aws_rds_cluster.main.database_name
  )
}
