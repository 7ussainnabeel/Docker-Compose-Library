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

# Select workflow
while true; do
  echo "Select an action:"
  echo "1) Install/Run (current workflow)"
  echo "2) Update stack (pull latest images and recreate non-database services only)"
  read -r -p "Enter choice [1-2]: " action_choice

  if [[ "$action_choice" == "1" ]]; then
    folder_selected=false

    # Prompt user to choose a folder
    echo "Choose a folder to cd into (enter 0 or 00 to go back):"
    select folder in */; do
      if [[ "$REPLY" == "0" || "$REPLY" == "00" ]]; then
        echo "Returning to workflow selection..."
        break
      elif [ -d "$folder" ]; then
        echo "Changing to the folder selected..."
        cd "$folder" || exit 1
        echo "Current directory: $(pwd)"
        folder_selected=true
        break
      else
        echo "Invalid selection. Please choose a valid folder, or 0/00 to go back."
      fi
    done

    if [ "$folder_selected" = false ]; then
      continue
    fi

    sleep 2

    # Run Docker Compose up -d
    echo "Running Docker Compose up -d..."
    "${COMPOSE_CMD[@]}" up -d
    break
  elif [[ "$action_choice" == "2" ]]; then
    update_folder_selected=false

    echo "Choose a folder to update (enter 0 or 00 to go back):"
    select update_dir in */; do
      if [[ "$REPLY" == "0" || "$REPLY" == "00" ]]; then
        echo "Returning to workflow selection..."
        break
      elif [ -d "$update_dir" ]; then
        echo "Changing to update folder..."
        cd "$update_dir" || exit 1
        echo "Current directory: $(pwd)"
        update_folder_selected=true
        break
      else
        echo "Invalid selection. Please choose a valid folder, or 0/00 to go back."
      fi
    done

    if [ "$update_folder_selected" = false ]; then
      continue
    fi

    sleep 2

    echo "Pulling latest Docker images..."
    "${COMPOSE_CMD[@]}" pull

    echo "Detecting services..."
    services=$("${COMPOSE_CMD[@]}" config --services)

    if [ -z "$services" ]; then
      echo "No Docker Compose services found in this folder."
      exit 1
    fi

    NON_DB_SERVICES=()
    DB_SERVICES=()

    for service in $services; do
      if [[ "$service" =~ (db|postgres|mysql|mariadb|mongo|redis|mssql|sqlserver|influx|cassandra|elasticsearch|opensearch) ]]; then
        DB_SERVICES+=("$service")
      else
        NON_DB_SERVICES+=("$service")
      fi
    done

    if [ ${#NON_DB_SERVICES[@]} -gt 0 ]; then
      echo "Recreating non-database services: ${NON_DB_SERVICES[*]}"
      "${COMPOSE_CMD[@]}" up -d --no-deps "${NON_DB_SERVICES[@]}"
    else
      echo "Only database-like services detected. Skipping service recreation."
    fi

    if [ ${#DB_SERVICES[@]} -gt 0 ]; then
      echo "Database-like services were not recreated: ${DB_SERVICES[*]}"
    fi
    break
  else
    echo "Invalid choice. Please choose 1 or 2."
  fi
done

sleep 2

# Verify the status with docker ps
echo "Verifying the status with docker ps..."
sudo docker ps
