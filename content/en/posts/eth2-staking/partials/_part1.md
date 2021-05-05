## Why Stake with Kubernetes? 
As stakers, we all want to minimize downtime and the risk of being slashed. 

Minimizing downtime is a difficult objective to achieve since a validator might be down for various reasons: system failures, incomplete restart policies, connectivity issues, hardware maintenance or software bugs. Staking with two or more machines for redundancy naturally comes to mind.

People might say, “redundancy leads to slashing!” which is a legitimate concern because we could accidentally run multiple validators with the same validator keys at the same time. Migrating the validators from a broken machine to the other with inappropriate procedure might in turn corrupt the slashing protection database . A staker with benign intention has the risk of being slashed due to the error-prone manual operations and the complexities increase when you have a high-availability setup. Needless to say, the experience could deteriorate if a staker runs multiple validators.

_Can we reduce the risk and the complexities of staking while running multiple validators and embracing redundancy?_ Yes, we think [Kubernetes](https://kubernetes.io/docs/concepts/overview/what-is-kubernetes/) can help us manage the application’s lifecycle and automate the upgrade rollouts. The process of upgrading a client would be completed in one-step. Furthermore, migrating a client from one machine to another also would be a single command (*e.g.* kubectl drain node). 

We hope this experiment and the setup guide can be a stepping stone for the community to stake with Kubernetes for Ethereum 2.0. Embrace the redundancy and stake with ease and scalability.

## Acknowledgement
We want to thank Ethereum Foundation for supporting this project via the [Eth2 Staking Community Grants](https://blog.ethereum.org/2021/02/09/esp-staking-community-grantee-announcement/). It’s an honor to contribute to this community! 

## Technologies

In this step-by-step guide, we run one beacon node with multiple validator clients in a Kuberenetes cluster for Ethereum 2.0 staking. We are using:

- [Prysm](https://github.com/prysmaticlabs/prysm) as the Ethereum 2.0 Client.
- [MicroK8s](https://microk8s.io/) as the Kubernertes destribution ([installation guide](https://microk8s.io/docs)).
- [Helm 3](https://helm.sh/) to manage packages and releases.
- [kubectl](https://kubernetes.io/docs/reference/kubectl/overview/) to run commands against Kubernetes clusters.
- Ubuntu Server 20.04.2 LTS (x64) ([download link](https://ubuntu.com/download/server)).
- [Network File System (NFS)](https://en.wikipedia.org/wiki/Network_File_System) as beacon and validator clients’ persistent storage ([Guide for NFS installation and configuration on Ubuntu](https://ubuntu.com/server/docs/service-nfs)).
- [eth2xk8s](https://github.com/lumostone/eth2xk8s) Helm Chart.

## Goal

This guide will help you to:

- Create a Kubernetes cluster with MicroK8s. If you already have your prefered Kubernetes distribution running you can jump to the section “[Install and Configure NFS](#install-and-configure-nfs)”. If you are using managed Kubernetes services provided by cloud providers (*e.g.* AKS, EKS, and GKE), you may consider using cloud storage directly rather than NFS as the persistent storage. We will cover this topic in the future.
- Install and configure NFS.
- Prepare the Helm Chart for multiple validator clients.
- Install Prysm’s beacon and validator clients with the Helm Chart.
- Check client status.
- Upgrade and roll back the Prysm’s beacon and validator clients with the Helm Chart.

## Non-Goal

This guide does not cover the following topics:

- Performance tuning and sizing.
- Guide to fund the validators and to generate the validator keys.
- Kubernetes cluster high availability (HA) configuration.
- Kubernetes cluster security hardening.

## Disclaimer

As of today, this setup has been tested in the testnet only. 

We all stake at our own risk. Please always do the experiments and dry-run on the testnet first, familiarize yourself with all the operations, and harden your systems before running it on the mainnet. This guide serves as a stepping stone for staking with Kubernetes. **The authors are not responsible for any financial losses incurred by following this guide.**

## System Requirements

We need at least 3 machines (virtual machines or bare-metal machines) in total for this setup. One machine will be the NFS server to store the staking data, the second machine will be the “master” node to run the Kubernetes core components, and finally, the third machine will be the “worker” node to run the workloads, which are the beacon and validator clients, in the Kubernetes cluster. For high availability (HA), you can consider adding more nodes by following [MicroK8s’ High Availability documentation](https://microk8s.io/docs/high-availability) and regularly backing up the beacon data for fast startup. We will discuss HA configurations in subsequent posts. 

Here are the recommended system requirements based on our testing on the [**Prater testnet**](https://prater.beaconcha.in/) and [MicroK8s’ documentation](https://microk8s.io/docs). **Please note that meeting the minimal requirements does not guarantee optimal performance or cost efficiency.**

Master:

- RAM: 8 GB minimum
- CPU: 1 core minimum
- Disk: 20 GB minimum

Worker:

- RAM: 8 GB minimum
- CPU: 1 core minimum
- Disk: 20 GB minimum

NFS:

- RAM: 2 GB minimum
- CPU: 1 core minimum
- Disk: 250 GB minimum (Again, please note it is for testnet. For running on the mainnet, you may need more storage.)

## Network Requirements

- Every machine needs to have outbound connectivity to the Internet at least during installation. 
- Masters and workers can reach to each other. We will configure the firewall in the following section to only allow the inbound traffic to the ports required by MicroK8s. For more details, you can refer to [MicroK8s’ documentation: Services and ports](https://microk8s.io/docs/ports).
- Masters and workers can reach the NFS server.
- Masters and workers can reach the endpoint of the Ethereum 1.0 “Goerli” node (Please refer to [Prerequisites](#prerequisites) for more information).

## Prerequisites

- You have funded your validators and have generated validator keys. If you need guidance, we recommend [Somer Esat’s guide](https://someresat.medium.com/guide-to-staking-on-ethereum-2-0-ubuntu-pyrmont-prysm-a10b5129c7e3).
- Ethereum 1.0 “Goerli” node: [Somer Esat’s guide](https://someresat.medium.com/guide-to-staking-on-ethereum-2-0-ubuntu-pyrmont-prysm-a10b5129c7e3) also covers steps for building the Ethereum 1.0 node. You can also choose a third-party provider such as [Infura](https://infura.io/) or [Alchemy](https://alchemyapi.io/).
- Planning your private network, firewall, and port forwarding. We have put our network configuration in the [Walkthrough](#overview) for your reference.
- You have installed Ubuntu Server 20.04.2 LTS (x64) on all the servers and have assigned static IPs.

## Walkthrough

### Overview

In this walkthrough, we will set up a Kubernetes cluster and a NFS server and install the beacon node and the validator clients. We put all the machines in the same private subnet and have assigned a static private IP for each machine. Here are the network configurations we use throughout this guide for the three machines:

**Private subnet: 172.20.0.0/20 (172.20.0.1 - 172.20.15.254)**
- NFS IP: 172.20.10.10
- Master IP: 172.20.10.11
- Worker IP: 172.20.10.12
- DNS: 8.8.8.8, 8.8.4.4 (Google’s DNS)

### System Update/Upgrade

Please run the commands below on all the machines:

```bash
sudo apt update && sudo apt upgrade
sudo apt dist-upgrade && sudo apt autoremove
sudo reboot
```

### Time Sync

Perform the following steps on all the machines:

1. Set your timezone. Using `America/Los_Angeles` as an example:

    ```bash
    timedatectl list-timezones
    sudo timedatectl set-timezone America/Los_Angeles
    ```

2. Confirm that the default timekeeping service is on (NTP service). 

    ```bash
    timedatectl
    ```

3. Install `chrony`.

    ```bash
    sudo apt install chrony
    ```

4. Edit the `chrony` configuration.

    ```bash
    sudo nano /etc/chrony/chrony.conf
    ```

    Add the following pools as the clock sources:

    ```bash
    pool time.google.com     iburst minpoll 1 maxpoll 2 maxsources 3
    pool us.pool.ntp.org     iburst minpoll 1 maxpoll 2 maxsources 3
    pool ntp.ubuntu.com      iburst minpoll 1 maxpoll 2 maxsources 3
    ```

    Update the two settings:

    ```bash
    maxupdateskew 5.0 # The threshold for determining whether an estimate is too unreliable to be used.
    makestep 0.1 -1  # This would step the system clock if the adjustment is larger than 0.1 seconds.
    ```

5. Restart the `chronyd` service.

    ```bash
    sudo systemctl restart chronyd
    ```

6. To see the source of synchronization data.

    ```bash
    chronyc sources
    ```

    To view the current status of `chrony`.

    ```bash
    chronyc tracking
    ```

### Configure Firewall

Perform step 1-3 on all the machines:

1. Set up default rules.

    ```bash
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    ```

2. (**Optional**) We suggest changing the ssh port from `22` to another port for security. You can open the `sshd_config` config file and change `Port 22` to your designated port:

    ```bash
    sudo nano /etc/ssh/sshd_config
    ```

    Then restart the `ssh` service.

    ```bash
    sudo service sshd restart
    ```

3. No matter which port is used, remember to allow inbound traffic to your ssh port over TCP:

    ```bash
    sudo ufw allow <ssh-port>/tcp
    ```

4. On the NFS server, add the rule for NFS service:

    ```bash
    sudo ufw allow 2049/tcp
    ```

5. On the master and worker machines, add the rules for MicroK8s services:

    ```bash
    sudo ufw allow 16443/tcp
    sudo ufw allow 10250/tcp
    sudo ufw allow 10255/tcp
    sudo ufw allow 25000/tcp
    sudo ufw allow 12379/tcp
    sudo ufw allow 10257/tcp
    sudo ufw allow 10259/tcp
    sudo ufw allow 19001/tcp
    ```

6. On the master and worker machines, add the rules for beacon node:

    ```bash
    sudo ufw allow 12000/udp
    sudo ufw allow 13000/tcp
    ```

7. Lastly, enable the firewall on each machine.

    ```bash
    sudo ufw enable
    sudo ufw status numbered
    ```

### Install MicroK8s

To install MicroK8s, you can refer to [MicroK8s’ installation guide](https://microk8s.io/docs) or follow the instructions below on both of the master and worker machines.

1. Install and run MicroK8s.

    ```bash
    sudo snap install microk8s --classic --channel=1.20/stable
    ```

2. To grant your non-root user the admin privilege to execute MicroK8s commands, add the user to the MicroK8s group and change the owner of `~/.kube` directory.

    ```bash
    sudo usermod -a -G microk8s $USER
    sudo chown -f -R $USER ~/.kube

    su - $USER # Re-enter the session for the update to take place.
    ```

3. Wait for MicroK8s to be ready.

    ```bash
    microk8s status --wait-ready
    ```

4. Double check the node is ready.

    ```bash
    microk8s kubectl get node
    ```

    You should only see one node in the result.

### Set up a Cluster

Please finish the previous section and make sure MicroK8s is running on both master and worker machines before proceeding.

On the master:

1. Enable DNS and Helm 3.

    ```bash
    microk8s enable dns helm3
    ```

2. Use the add-node command to generate a connection string for the worker node to join the cluster.

    ```bash
    microk8s add-node
    ```

    You should see output like this:

    ```bash
    Join node with:
    microk8s join 172.31.20.243:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf

    If the node you are adding is not reachable through the default
    interface you can use one of the following:

    microk8s join 172.31.20.243:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf
    microk8s join 10.1.84.0:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf
    ```

On the worker:

1. Copy the join command and join the cluster. For example,

    ```bash
    microk8s join 172.31.20.243:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf
    ```

2. After the joining is done, check whether the worker node is in the cluster.

    ```bash
    microk8s kubectl get node
    ```

    You should see both master and worker nodes in the result.
