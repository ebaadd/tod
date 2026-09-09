# Pay-per-use cuts both ways: nothing bills while the app is idle, and nothing
# stops billing if it is hammered. These are the brakes.
#
# The hard cap is api_reserved_concurrency in lambda.tf. Everything here only
# tells you what is happening -- a budget alert does not stop spending.

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  # Warns on the trajectory rather than after the money is spent.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Throttling means real users are being turned away, so it needs to page you
# rather than sit in a dashboard.
resource "aws_cloudwatch_metric_alarm" "api_throttled" {
  alarm_name          = "${var.name}-api-throttled"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "API hit its concurrency ceiling; raise it or shed load."
  dimensions          = { FunctionName = aws_lambda_function.api.function_name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${var.name}-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { FunctionName = aws_lambda_function.api.function_name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Grouping falling behind means owners see ungrouped duplicates in the inbox.
resource "aws_cloudwatch_metric_alarm" "grouping_iterator_age" {
  alarm_name          = "${var.name}-grouping-lag"
  namespace           = "AWS/Lambda"
  metric_name         = "IteratorAge"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 600000
  comparison_operator = "GreaterThanThreshold"
  alarm_description   = "Grouping is more than 10 minutes behind the stream."
  dimensions          = { FunctionName = aws_lambda_function.grouping.function_name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
