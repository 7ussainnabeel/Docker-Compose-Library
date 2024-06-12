#!/bin/bash
# # ASCII art header 
# echo " 
#   _    _                                                    _       _     
#  | |  | |                                                  | |     | |    
#  | |__| | ___  _   _ ___  ___  ___  ___ _ ____   _____ _ __| | __ _| |__  
#  |  __  |/ _ \| | | / __|/ _ \/ __|/ _ \ '__\ \ / / _ \ '__| |/ _` | '_ \ 
#  | |  | | (_) | |_| \__ \  __/\__ \  __/ |   \ V /  __/ |  | | (_| | |_) |
#  |_|  |_|\___/ \__,_|___/\___||___/\___|_|    \_/ \___|_|  |_|\__,_|_.__/                                                                                                                      
# "

# Prompt user to choose a folder
echo "Choose a folder to cd into:"
select folder in */; do
  break
done

# Cd into the chosen folder
cd "$folder"

# Run docker-compose up -d
echo "Running docker-compose up -d..."
sudo docker-compose up -d

# Verify the status with docker ps
echo "Verifying the status with docker ps..."
sudo docker ps
done
