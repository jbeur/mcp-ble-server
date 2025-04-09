#!/bin/bash

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build essentials
sudo apt-get install -y build-essential

# Create deployment user
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG sudo deploy

# Create application directory
sudo mkdir -p /var/www/mcp-ble-server
sudo chown deploy:deploy /var/www/mcp-ble-server

# Set up SSH directory for deploy user
sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo touch /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh

# Install PM2 for process management
sudo npm install -g pm2

# Create systemd service for the application
sudo tee /etc/systemd/system/mcp-ble-server.service << EOF
[Unit]
Description=MCP BLE Server
After=network.target

[Service]
User=deploy
WorkingDirectory=/var/www/mcp-ble-server
ExecStart=/usr/bin/pm2 start npm --name "mcp-ble-server" -- start
Restart=always
Environment=NODE_ENV=staging

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable mcp-ble-server

echo "Staging server setup complete!"
echo "Next steps:"
echo "1. Add your public SSH key to /home/deploy/.ssh/authorized_keys"
echo "2. Update the GitHub workflow file with your server's public IP"
echo "3. Test the deployment" 