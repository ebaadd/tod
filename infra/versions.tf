terraform {
  required_version = ">= 1.6"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "tod"
      ManagedBy = "terraform"
    }
  }
}

# CloudFront certificates and WAF must live in us-east-1 no matter where the
# rest of the stack runs.
provider "aws" {
  alias  = "edge"
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}
