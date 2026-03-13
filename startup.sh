#!/bin/bash
# ASCII art header 
echo " 
  _    _                                                    _       _     
 | |  | |                                                  | |     | |    
 | |__| | ___  _   _ ___  ___  ___  ___ _ ____   _____ _ __| | __ _| |__  
 |  __  |/ _ \| | | / __|/ _ \/ __|/ _ \ '__\ \ / / _ \ '__| |/ _\` | '_ \ 
 | |  | | (_) | |_| \__ \  __/\__ \  __/ |   \ V /  __/ |  | | (_| | |_) |
 |_|  |_|\___/ \__,_|___/\___||___/\___|_|    \_/ \___|_|  |_|\__,_|_.__/                                                                                                                      
"

# Check if Docker is installed
if ! command -v docker &> /dev/null
then
    echo "Docker is not installed. Installing Docker..."
    
    # Update the apt package index
    sudo apt-get update
    
    # Install packages to allow apt to use a repository over HTTPS
    sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common
    
    # Add Docker's official GPG key
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    # Set up the stable repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Update the apt package index again
    sudo apt-get update
    
    # Install the latest version of Docker CE and containerd
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io
    
    # Add the current user to the Docker group
    sudo usermod -aG docker $USER
    
    # Apply the new group membership
    newgrp docker
    
    echo "Docker has been installed successfully."
else
    echo "Docker is already installed."
fi

# Check for Docker Compose (v2 plugin or v1 binary)
if docker compose version &> /dev/null
then
  echo "Docker Compose v2 plugin is already installed."
  COMPOSE_CMD=(sudo docker compose)
elif command -v docker-compose &> /dev/null && docker-compose version &> /dev/null
then
  echo "Docker Compose v1 binary is already installed."
  COMPOSE_CMD=(sudo docker-compose)
else
  echo "Docker Compose not found. Trying to install Docker Compose v2 plugin..."
  sudo apt-get update
  sudo apt-get install -y docker-compose-plugin

  if docker compose version &> /dev/null
  then
    echo "Docker Compose v2 plugin has been installed successfully."
    COMPOSE_CMD=(sudo docker compose)
  else
    echo "Docker Compose v2 plugin installation failed. Trying Docker Compose v1 binary..."

    sudo curl -fL "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose

    if command -v docker-compose &> /dev/null && docker-compose version &> /dev/null
    then
      echo "Docker Compose v1 has been installed successfully."
      COMPOSE_CMD=(sudo docker-compose)
    else
      echo "Failed to install Docker Compose v1 and v2."
      exit 1
    fi
  fi
fi

sleep 3

# Prompt user to choose a folder
echo "Choose a folder to cd into:"
select folder in */; do
  if [ -d "$folder" ]; then
    echo "Changing to the folder selected..."
    cd "$folder"
    echo "Current directory: $(pwd)"
    break
  else
    echo "Invalid selection. Please choose a valid folder."
  fi
done

sleep 2

# Run Docker Compose up -d
echo "Running Docker Compose up -d..."
"${COMPOSE_CMD[@]}" up -d

sleep 2

# Verify the status with docker ps
echo "Verifying the status with docker ps..."
sudo docker ps
