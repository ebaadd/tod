variable "region" {
  description = "Region for everything except CloudFront."
  type        = string
  default     = "ap-south-1"
}

variable "name" {
  description = "Prefix for resource names."
  type        = string
  default     = "tod"
}

variable "image_tag" {
  description = "ECR tag to deploy. Set by deploy.sh after the push."
  type        = string
}

variable "alert_email" {
  description = "Address that receives budget alerts."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Budget threshold. Alerts only; it does not stop spending."
  type        = number
  default     = 5
}

variable "api_reserved_concurrency" {
  description = <<-TEXT
    Hard ceiling on simultaneous API executions. This is the most effective
    cap on a runaway bill: requests beyond it are throttled, not billed.
    Raise it deliberately if the app takes off.
  TEXT
  type        = number
  default     = 50
}

variable "aurora_engine_version" {
  description = <<-TEXT
    Scaling to 0 ACU needs Aurora PostgreSQL 13.15+, 14.12+, 15.7+ or 16.3+.
    Confirm availability with:
      aws rds describe-db-engine-versions --engine aurora-postgresql
  TEXT
  type        = string
  default     = "16.4"
}

variable "aurora_max_acu" {
  description = "Upper bound on Aurora capacity. 0 is the floor, so it pauses when idle."
  type        = number
  default     = 4
}

variable "retention_days" {
  type    = number
  default = 90
}

variable "session_days" {
  type    = number
  default = 30
}

variable "web_origin" {
  description = <<-TEXT
    The site's public origin, e.g. https://d111.cloudfront.net.

    This exists to break a dependency cycle: the API needs to know the site's
    origin, and the distribution needs the API's URL. Leave it empty on the
    first apply, then set it from the site_url output. deploy.sh does both
    applies for you, so it is idempotent from then on.
  TEXT
  type        = string
  default     = ""
}

variable "cloudfront_price_class" {
  description = <<-TEXT
    PriceClass_100 covers only North America and Europe. If your audience is
    in India or elsewhere in Asia, that routes them to distant edge locations.
    PriceClass_200 adds India, Japan and South East Asia for slightly more.
  TEXT
  type        = string
  default     = "PriceClass_200"
}
