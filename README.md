Project Name
================

This is a brief description of the project.

Table of Contents
Getting Started
Features
Installation
Usage
Contributing
License
Getting Started
To get started with this project, follow these steps:

Prerequisites
[List any prerequisites, such as software or libraries required]
Installation
See the Installation section for instructions on how to install this project.

Features
[List the key features of the project]
Installation
Method 1: Clone the Repository
Copy code
git clone https://github.com/your-username/your-repo-name.git
Method 2: Install using [Package Manager]
Copy code
[package-manager] install [package-name]
Usage
[Provide examples of how to use the project]
Contributing
Contributions are welcome! Please see the Contributing Guidelines for more information.

License
This project is licensed under the MIT License. See the LICENSE file for more details.





Docker-Compose Library
A collection of ready-to-use and hopefully updated open-source applications with the help of Docker-Compose.

Clone the Repository
bash
Copy code
git clone https://github.com/7ussainnabeel/Docker-Compose-Library.git
cd Docker-Compose-Library
Usage
Navigate to the Repository

After cloning the repository, navigate to the Docker-Compose-Library directory:

bash
Copy code
cd Docker-Compose-Library
Choose a Folder

Prompt the user to choose a folder number corresponding to the desired application:

bash
Copy code
echo "Please choose a folder number corresponding to the application you want to run:"
ls -1
read -p "Enter the folder number: " folder_number
Change Directory

Change to the chosen folder:

bash
Copy code
cd $(ls -1 | sed -n "${folder_number}p")
Run Docker-Compose

Run docker-compose in detached mode:

bash
Copy code
docker-compose up -d
Verify Status

Verify the status of the containers:

bash
Copy code
docker-compose ps
Contributing
Feel free to contribute by adding more applications or updating the existing ones. Make sure to:

License
This project is licensed under the MIT License. See the LICENSE file for more details.

Contact
For any questions or suggestions, please open an issue or contact the repository owner.

Enjoy using the Docker-Compose Library! 🚀

## Applications list

| Name                                        | Category              |
| ------------------------------------------- | --------------------- |
| [Ghost](blog/ghost.yml)                     | blog                  |
| [Bonita](business-intelligence/bonita.yml)  | business-intelligence |
| [Shout](chat/shout.yml)                     | chat                  |
| [drupal](cms/drupal.yml)                    | cms                   |
| [joomla](cms/joomla.yml)                    | cms                   |
| [wordpress](cms/wordpress.yml)              | cms                   |
| [eXo](collaboration/eXo.yml)                | collaboration         |
| [gitlab](collaboration/gitlab.yml)          | collaboration         |
| [hastebin](collaboration/hastebin.yml)      | collaboration         |
| [hublin](collaboration/hublin.yml)          | collaboration         |
| [mattermost](collaboration/mattermost.yml)  | collaboration         |
| [openfire](collaboration/openfire.yml)      | collaboration         |
| [rocket.chat](collaboration/rocketchat.yml) | collaboration         |
| [suitecrm](crm/suitecrm.yml)                | crm                   |
| [mongo](database/suitecrm.yml)              | database              |
| [mysql](database/mysql.yml)                 | database              |
| [postgres](database/postgres.yml)           | database              |
| [redis](database/redis.yml)                 | database              |
| [kong](development/kong.yml)                | development           |
| [sonarqube](development/sonarqube.yml)      | development           |
| [alfresco](document/alfresco.yml)           | document              |
| [ckan](document/ckan.yml)                   | document              |
| [logicaldoc](document/logicaldoc.yml)       | document              |
| [nuxeo](document/nuxeo.yml)                 | document              |
| [xibo](document/xibo.yml)                   | document              |
| [prestashop](document/prestashop.yml)       | ecommerce             |
| [odoo](erp/odoo.yml)                        | erp                   |
| [tuleap](project-management/tuleap.yml)     | project-management    |
| [owncloud](storage/owncloud.yml)            | storage               |
| [mistserver](streaming/mistserver.yml)      | streaming             |
| [red5](streaming/red5.yml)                  | streaming             |
| [osticket](trouble-ticketing/osticket.yml)  | trouble-ticketing     |
| [redmine](trouble-ticketing/redmine.yml)    | trouble-ticketing     |
| [dokuwiki](wiki/dokuwiki.yml)               | wiki                  |
| [mediawiki](wiki/mediawiki.yml)             | wiki                  |

## scripts

### unify_yamls.py

undocumented and probably going to be deprecated

### v1_to_v2.py

deprecated: bulk update from v1 to v2 composer:
`find . -name "*.yml" -exec python v1_to_v2.py --source {} --destination {} \;`
# docker-compose

This is a collection of all my `docker-compose.yml`-files.  
I hope they're time-saving for you guys.