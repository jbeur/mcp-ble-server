#!/bin/bash
set -e

# Install required packages
apt-get update
apt-get install -y nodejs npm git

# Install PM2 globally
npm install -g pm2

# Create app directory
mkdir -p /var/www/mcp-ble-server
cd /var/www/mcp-ble-server

# Clone the repository
git clone https://github.com/yourusername/mcp-ble-server.git .

# Install dependencies
npm install

# Create environment file
cat > .env << EOL
NODE_ENV=${environment}
AWS_REGION=${aws_region}
DB_HOST=${db_host}
DB_PORT=${db_port}
DB_NAME=${db_name}
DB_USER=${db_username}
DB_PASSWORD=${db_password}
EOL

# Start the application with PM2
pm2 start src/index.js --name mcp-ble-server
pm2 save
pm2 startup

# Configure CloudWatch agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOL
{
  "metrics": {
    "namespace": "MCP-BLE-Server",
    "metrics_collected": {
      "cpu": {
        "measurement": ["cpu_usage_idle", "cpu_usage_iowait", "cpu_usage_user", "cpu_usage_system"]
      },
      "disk": {
        "measurement": ["used_percent", "inodes_free"],
        "resources": ["/"]
      },
      "diskio": {
        "measurement": ["io_time", "write_bytes", "read_bytes", "writes", "reads"]
      },
      "mem": {
        "measurement": ["mem_used_percent"]
      },
      "net": {
        "measurement": ["bytes_sent", "bytes_recv", "packets_sent", "packets_recv"]
      }
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/mcp-ble-server.log",
            "log_group_name": "/ec2/${environment}-mcp-ble-server",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
EOL

# Start CloudWatch agent
systemctl start amazon-cloudwatch-agent 