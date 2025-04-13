# Docker Compose Library

## Description
The Docker Compose Library is a curated collection of ready-to-use and continuously updated open-source applications. By leveraging Docker Compose, this library simplifies the deployment and management of various applications, making it easier for developers and system administrators to set up and run complex software environments.

## How to Use

### Quick Start
1. Clone this repository:
```bash
git clone https://github.com/7ussainnabeel/Docker-Compose-Library.git
```

2. Navigate to the cloned directory:
```bash
cd Docker-Compose-Library
```

3. Make the startup script executable and run it:
```bash
chmod +x startup.sh
./startup.sh
```

## Deployment

1. Choose a Folder:
   - The script will present a list of available applications
   - Select the number corresponding to your desired application

2. Automatic Deployment:
   - The startup script will handle all deployment steps automatically
   - Typical deployment takes 5-10 minutes

3. Verify Deployment:
   - After completion, check running containers with:
```bash
sudo docker ps
```

### Manual Deployment (Alternative)
For manual control, you can directly run Docker Compose:
```bash
docker-compose -f <application-folder>/docker-compose.yml up -d
```

## Applications Overview

### Administration
- **Aurora-Admin-Panel**: Admin panel for managing applications.
- **dashy**: Dashboard for monitoring services.
- **rancherv1**: Container management platform.
- **traefik**: Modern reverse proxy and load balancer.

### Business Applications
- **business-intelligence**: Business intelligence tools.
- **dolibarr**: ERP and CRM software.
- **microrealestate**: Real estate management application.
- **opeprojects**: Project management tools.

### Communication
- **chat**: Chat application.
- **crewlink**: Voice chat application.
- **mattermost**: Open-source messaging platform.
- **openfire**: Real-time collaboration server.
- **rocketchat**: Team collaboration platform.
- **teamspeak**: Voice communication software.

### Content Management
- **blog**: Blogging platform.
- **cms**: Content management systems (Drupal, Joomla, WordPress).
- **docuseal**: Document management system.
- **rainloop**: Webmail client.
- **wiki**: Wiki software (DokuWiki, MediaWiki).
- **wordpress**: Popular content management system.

### Customer Relationship Management
- **crm**: Customer relationship management software.
- **faveo**: Helpdesk and support ticketing system.
- **freescout**: Open-source help desk.
- **uvdesk**: Helpdesk solution.
- **zammad**: Web-based support ticket system.

### Databases
- **database**: Database management systems (MongoDB, MySQL, PostgreSQL, Redis).

### Development Tools
- **development**: Development tools and environments.
- **full_php_dev_stack**: Full PHP development stack.
- **gatling-grafana**: Load testing and monitoring tools.
- **gitea**: Self-hosted Git service.
- **gitlab**: Git repository manager.
- **jekyll-static-ssh-deploy**: Static site generator deployment.
- **scripts**: Utility scripts for various tasks.

### Document Management
- **document**: Document management systems (Alfresco, CKAN, LogicalDOC, Nuxeo, Xibo).

### E-commerce
- **ecommerce**: E-commerce platforms.
- **invoice-ninja**: Invoicing and billing software.
- **peppermint**: E-commerce solution.

### Help Desk & Ticketing
- **trouble-ticketing**: Help desk and ticketing systems (osTicket, Redmine).

### Multimedia
- **multimedia**: Multimedia applications.
- **plex**: Media server.
- **sinusbot**: Music bot for TeamSpeak.
- **streaming**: Streaming applications (MistServer, Red5).

### Networking
- **nginx_proxy-and-companion**: Nginx reverse proxy.
- **openvpn**: OpenVPN server.
- **varnish-cache**: HTTP accelerator.

### Productivity
- **nextcloud**: File sharing and collaboration platform.
- **passbolt**: Open-source password manager.
- **remotely**: Remote access tools.

### Project Management
- **project-management**: Project management tools.

### Security
- **matomo**: Web analytics platform.
- **passbolt**: Password management solution.

### Games
- **ark-server**: Game server for ARK: Survival Evolved.

### Platform-Specific Configurations
#### Windows
- **Windows Container**: 
  - Pre-configured Docker environment for running Windows
  - Includes RDP access (port 3389) and web interface (port 8006)
  - Default disk size: 256GB

#### Mac OS
- **Mac OS Container**: 
  - Pre-configured Docker environment for running macOS
  - Includes VNC access (port 5900) and web interface (port 8006)
  - Default disk size: 256GB
