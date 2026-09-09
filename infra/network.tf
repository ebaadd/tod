# Aurora is only reachable inside a VPC, so the functions that talk to it must
# join one. The expensive mistake here is a NAT gateway: about $32 a month
# before any traffic, purely so a private subnet can reach AWS APIs.
#
# It is avoided completely. DynamoDB is reached through a gateway endpoint,
# which is free, and nothing else in the request path needs the internet --
# the embedding model is baked into the container image rather than fetched.

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.name}-vpc" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.name}-private-${count.index}" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name}-private" }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Free. An interface endpoint would bill hourly per availability zone.
resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = { Name = "${var.name}-dynamodb" }
}

resource "aws_security_group" "lambda" {
  name        = "${var.name}-lambda"
  description = "Lambda functions that reach Aurora and DynamoDB"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "All outbound; there is no route to the internet anyway"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "database" {
  name        = "${var.name}-database"
  description = "Aurora, reachable only from the Lambda security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from the functions"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}
