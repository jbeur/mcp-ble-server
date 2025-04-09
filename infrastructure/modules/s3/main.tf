resource "aws_s3_bucket" "assets" {
  bucket = "${var.environment}-mcp-ble-server-assets"

  tags = {
    Name        = "${var.environment}-mcp-ble-server-assets"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM policy for EC2 instances to access the S3 bucket
data "aws_iam_policy_document" "s3_access" {
  statement {
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
      "s3:DeleteObject"
    ]

    resources = [
      aws_s3_bucket.assets.arn,
      "${aws_s3_bucket.assets.arn}/*"
    ]
  }
}

resource "aws_iam_policy" "s3_access" {
  name        = "${var.environment}-s3-access"
  description = "Policy for EC2 instances to access S3 bucket"
  policy      = data.aws_iam_policy_document.s3_access.json
}

output "bucket_name" {
  value = aws_s3_bucket.assets.id
}

output "bucket_arn" {
  value = aws_s3_bucket.assets.arn
}

output "s3_access_policy_arn" {
  value = aws_iam_policy.s3_access.arn
} 