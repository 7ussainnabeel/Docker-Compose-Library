#!/bin/bash
# Working progress.
# Integrate more interactive choices:
# What would you like to do? 1. launch a server 2. delete a container 3. example, etc. 

while :
do

# ASCII art header 
    echo """ 
  _    _                                                    _       _     
 | |  | |                                                  | |     | |    
 | |__| | ___  _   _ ___  ___  ___  ___ _ ____   _____ _ __| | __ _| |__  
 |  __  |/ _ \| | | / __|/ _ \/ __|/ _ \ '__\ \ / / _ \ '__| |/ _` | '_ \ 
 | |  | | (_) | |_| \__ \  __/\__ \  __/ |   \ V /  __/ |  | | (_| | |_) |
 |_|  |_|\___/ \__,_|___/\___||___/\___|_|    \_/ \___|_|  |_|\__,_|_.__/ 
                                                                          
                                                                                                                 
    """

    # Instructions
    echo "Welcome to Decyphertek - Decoding Technology."  
    echo "---------------------------------------------"
    echo "What would you like to do?"
    echo "1. Launch a server"
    echo "2. Delete a container"
    echo "3. Example task"
    echo "4. Exit"
    read -p "Enter your choice [1-4]: " CHOICE

    case $CHOICE in
        1)
            # Launch a server
            cd ~/.docker && ls
            echo "----------------------------------------------"
            echo "Which docker compose would you like to run?"
            read -p "Enter the name of the docker compose directory: " DOCKER_CHOICE
            if [ -d "$DOCKER_CHOICE" ]; then
                echo "We are launching $DOCKER_CHOICE, please be patient."
                cd "$DOCKER_CHOICE"
                docker-compose up -d 
                docker ps | grep "$DOCKER_CHOICE"
                echo "-------------------------------"
                echo "$DOCKER_CHOICE is now ready!!!"
                echo "-------------------------------"
            else
                echo "Directory $DOCKER_CHOICE does not exist."
            fi
            ;;
        2)
            # Delete a container
            echo "Current running containers:"
            docker ps
            echo "----------------------------------------------"
            echo "Which container would you like to delete?"
            read -p "Enter the container ID or name: " CONTAINER_ID
            docker rm -f "$CONTAINER_ID"
            echo "Container $CONTAINER_ID has been deleted."
            ;;
        3)
            # Example task
            echo "Performing example task..."
            # Add your example task commands here
            ;;
        4)
            # Exit
            echo "Exiting..."
            exit 0
            ;;
        *)
            echo "Invalid choice. Please enter a number between 1 and 4."
            ;;
    esac

    echo "Press ENTER to continue..."
    read
done
