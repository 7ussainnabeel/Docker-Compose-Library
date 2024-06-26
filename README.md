<h1 align=“center">This Project is a Docker Compose Library</h1>

<p align="center">
<b><i>Comprehensive, Docker-Compose files of open-source softwares used in businesses and home labs</I></b>
<br/>
<b></b>

</p>

---
## About

The Docker-Compose Library is a curated collection of ready-to-use and continuously updated open-source applications. By leveraging Docker-Compose, this library simplifies the deployment and management of various applications, making it easier for developers and system administrators to set up and run complex software environments.

## Description
This repository contains a collection of Docker-Compose files for various open-source applications, including:
- **Productivity Tools**: Nextcloud, OnlyOffice, Collabora Online, etc.
- **Development Tools**: GitLab, Jenkins, SonarQube, etc.
- **Security Tools**: OWASP ZAP, Burp Suite, etc.
- **Monitoring and Logging Tools**: Prometheus, Grafana, ELK Stack, etc.
- **Database Management Systems**: MySQL, PostgreSQL, MongoDB, etc.
- **Web Servers and Proxies**: Nginx, Apache, Traefik, etc.
- **Virtualization and Orchestration Tools**: Docker Swarm, Kubernetes, etc.
- **Other Tools**: FileBrowser, Portainer, etc.

This project provides a diverse set of Docker-Compose files, each pre-configured for a specific application. It caters to a wide range of needs, from admin panels and CMS to databases and machine learning tools. The library is designed to be user-friendly, making it accessible even to those who are new to Docker.

## Installation

- Just, Clone this repository -
  ```
  git clone https://github.com/7ussainnabeel/Docker-Compose-Library.git
  ```

- Now go to cloned directory -
  ```
  $ cd Docker-Compose-Library
  ```
- Run the bash script
    ```
  $ bash startup.sh
    ```
## Deployment

- Choose a Folder

    Choose the folder number corresponding to the desired application

- Bash script will do the magic

    Run the script and wait (5-10 min) container will be ready to double check run the following
    ```
    sudo docker ps
    ```
- **NOTE.** Container may take more time depending on your machine processing speed.

## Features

* **Wide Range of Applications**: The library includes a diverse set of applications, catering to different needs and use cases. 
* **Easy to Use**: Each application is containerized and configured with Docker-Compose, enabling quick and hassle-free deployments. 
* **Continuous Updates**: The repository is regularly updated to include the latest versions and best practices for each application. 
* **Community-Driven**: Contributions from the community are encouraged and welcomed, ensuring the library grows and evolves with user needs.


## Applications list

### Administration
* Aurora-Admin-Panel  
* dashy  
* rancherv1  
* traefik  

### Communication
* chat  
* crewlink  
* rocketchat  
* teamspeak  

### Collaboration
* collaboration  
* remotely  
* nextcloud  
* mykuma  

### Content Management
* blog  
* cms  
* docuseal  
* rainloop  
* wiki  
* wordpress  

### Customer Relationship Management (CRM)
* crm  
* dolibarr  
* faveo  
* freescout  
* uvdesk  
* zammad  

### Development
* development  
* full_php_dev_stack  
* gatling-grafana  
* gitea  
* gitlab  
* jekyll-static-ssh-deploy  
* scripts  

### E-commerce
* ecommerce  
* invoice-ninja  
* peppermint  

### Enterprise Resource Planning (ERP)
* erp  

### Multimedia
* multimedia  
* sinusbot  
* streaming  

### Networking
* openvpn  
* nginx_proxy-and-companion  

### Project Management
* business-intelligence  
* project-management  
* opeprojects  

### Storage
* database  
* document  
* storage  

### Ticketing Systems
* trouble-ticketing  

### Security
* passbolt  

### Web Analytics
* matomo  

### Web Server
* varnish-cache  

### Games
* ark-server  
* crewlink
## Support

For support, [email](hnabeel3@gmail.com).

The repo will remain 100% free and open source..
It's thanks to the support of the community that this project is able to be freely available for everyone :)

## Contributing

Contributions are always welcome!

Feel free to contribute by adding more applications or updating the existing ones. Make sure to:

* Fork the repository
* Create a new branch for your feature or fix
* Open a pull request with a detailed description of the changes

#### There is no infrastructure limitation

You can run the docker container on any infrastructure as long as you have **docker.io** and **docker-compose** installed

- **OS**: Red Hat, CentOS, Debian, Ubuntu or other's Linux OS ...
- **Public Cloud**: More than 20+ major Cloud such as AWS, Azure, Google Cloud, Akamai ...
- **Private Cloud**: KVM, VMware, VirtualBox, OpenStack ...
- **ARCH**: Linux x86-64, ARM 32/64, x86/i686 ...

## License

The MIT License (MIT)
Copyright (c) Hussain Dahi <hnabeel3@gmail.com> 

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


> **[Docker-Compose-Library](https://github.com/7ussainnabeel/Docker-Compose-Library.git)** is Licensed under [Hussain Dahi](https://github.com/7ussainnabeel/Docker-Compose-Library?tab=MIT-1-ov-file).


## Contact
For any questions or suggestions, please open an issue or contact the repository owner [Hussain Dahi](hnabeel3@gmail.com).
<h2><p  align="center">
Running your services in your home is fun :)</h2></p>
<br/> 

```
  _    _                                                       _       _     
 | |  | |                                                     | |     | |    
 | |__| | ___  _   _ ___  ___   ___  ___ _ ____   _____ _ __  | | __ _| |__  
 |  __  |/ _ \| | | / __|/ _ \ / __|/ _ \ '__\ \ / / _ \ '__| | |/ _` | '_ \ 
 | |  | | (_) | |_| \__ \  __/ \__ \  __/ |   \ V /  __/ |    | | (_| | |_) |
 |_|  |_|\___/ \__,_|___/\___| |___/\___|_|    \_/ \___|_|    |_|\__,_|_.__/   

```