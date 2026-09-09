output "site_url" {
  description = "Public URL. Feed this back in as web_origin; deploy.sh does it."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "migrate_function" {
  description = "Invoke after a schema change: aws lambda invoke --function-name <this> /dev/stdout"
  value       = aws_lambda_function.migrate.function_name
}

output "database_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "database_url" {
  description = "Contains the master password."
  value       = local.database_url
  sensitive   = true
}

output "region" {
  value = var.region
}
