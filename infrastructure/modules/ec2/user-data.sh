#!/bin/bash

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install git
sudo apt-get update
sudo apt-get install -y git

# Clone the repository
git clone https://github.com/your-username/mcp-ble-server.git /opt/mcp-ble-server
cd /opt/mcp-ble-server

# Install dependencies
npm install

# Create environment file
cat > .env << EOL
NODE_ENV=${environment}
DB_HOST=${db_host}
DB_PORT=${db_port}
DB_NAME=${db_name}
DB_USER=${db_username}
DB_PASSWORD=${db_password}
EOL

# Start the application with PM2
pm2 start src/index.js --name "mcp-ble-server"

# Configure PM2 to start on boot
pm2 startup
pm2 save

# Install and configure CloudWatch agent
sudo apt-get install -y amazon-cloudwatch-agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard
sudo systemctl enable amazon-cloudwatch-agent
sudo systemctl start amazon-cloudwatch-agent 