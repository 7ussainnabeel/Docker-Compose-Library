#!/bin/bash
# Working progress.
# Integrate more interactive choices:
# what would you like to do? 1. launch a server 2. delete a container 3. example, etc. 

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
    # Choose your docker compose server. 
    cd ~/.docker && ls
    echo "----------------------------------------------"
    echo "Which docker compose would you like to run?"
    read DOCKER_CHOICE
    # Depending on the choice will run a docker-compose.yml for the chosen server.  
    echo "We are launching $DOCKER_CHOICE, please be patient."
    cd $DOCKER_CHOICE
    docker-compose up -d 
    docker ps | grep $DOCKER_CHOICE
    echo "-------------------------------"
    echo "$DOCKER_CHOICE is now ready!!!"
    echo "-------------------------------"
	echo "Press CTRL+C to exit"
	sleep 3
done