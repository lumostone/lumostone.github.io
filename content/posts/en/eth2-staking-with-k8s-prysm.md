---
title: "Guide to Ethereum 2.0 Staking with Kubernetes and Prysm"
date: 2021-04-12T23:53:09Z
draft: true
tags: ["ethereum", "kubernetes", "tutorial"]
---

## Why Stake with Kubernetes? 
As stakers, we all want to minimize downtime and the risk of being slashed. 

Minimizing downtime is a difficult objective to achieve since a validator might be down for various reasons: system failures, incomplete restart policies, connectivity issues, hardware maintenance or software bugs. Staking with two or more machines for redundancy naturally comes to mind.

People might say, “redundancy leads to slashing!” which is a legitimate concern because we could accidentally run multiple validators with the same validator keys at the same time. Migrating the validators from a broken machine to the other with inappropriate procedure might in turn corrupt the slashing protection database . A staker with benign intention has the risk of being slashed due to the error-prone manual operations and the complexities increase when you have a high-availability setup. Needless to say, the experience could deteriorate if a staker runs multiple validators.

*Can we reduce the risk and the complexities of staking while running multiple validators and embracing redundancy?* Yes, we think [Kubernetes](https://kubernetes.io/docs/concepts/overview/what-is-kubernetes/) can help us manage the application’s lifecycle and automate the upgrade rollouts. The process of upgrading a client would be completed in one-step. Furthermore, migrating a client from one machine to another also would be a single command (*e.g.* kubectl drain node). 

We hope this experiment and the setup guide can be a stepping stone for the community to stake with Kubernetes for Ethereum 2.0. Embrace the redundancy and stake with ease and scalability.

## Acknowledgement
We want to thank Ethereum Foundation for supporting this project via the [Eth2 Staking Community Grants](https://blog.ethereum.org/2021/02/09/esp-staking-community-grantee-announcement/). It’s an honor to contribute to this community! 

## Technologies

In this step-by-step guide, we run one beacon node with multiple validators in a Kuberenetes cluster for Ethereum 2.0 staking. We are using:

- [Prysm](https://github.com/prysmaticlabs/prysm) as the Ethereum 2.0 Client.
- [MicroK8s](https://microk8s.io/) as the Kubernertes destribution ([installation guide](https://microk8s.io/docs)).
- [Helm](https://helm.sh/) to manage packages and releases.
- [kubectl](https://kubernetes.io/docs/reference/kubectl/overview/) to run commands against Kubernetes clusters.
- Ubuntu Server 20.04.2 LTS (x64) ([download link](https://ubuntu.com/download/server)).
- [Network File System (NFS)](https://en.wikipedia.org/wiki/Network_File_System) as beacon and validator’s persistent storage ([Guide for NFS installation and configuration on Ubuntu](https://ubuntu.com/server/docs/service-nfs)).
- [eth2xk8s](https://github.com/eth2xk8s/eth2xk8s) Helm chart.

## Goal

This guide will help you to:

- Create a Kubernetes cluster with MicroK8s. If you already have your prefered Kubernetes distribution running you can jump to the section “[Install and Configure NFS](#install-and-configure-nfs)”. If you are using managed Kubernetes services provided by cloud providers (*e.g.* AKS, EKS, and GKE), you may consider using cloud storage directly rather than NFS as the persistent storage. We will cover this topic in the future.
- Install and configure NFS.
- Prepare the Helm chart for multiple validators.
- Install Prysm’s beacon and validator clients with the Helm chart.
- Check client status.
- Upgrade and roll back the Prysm’s beacon and validator clients with the Helm chart.

## Non-Goal

This guide does not:

- Cover the performance tuning and sizing.
- Cover the steps to fund the validators and to generate the validator keys.
- Include Kubernetes cluster high availability (HA) configuration and security hardening.

## Disclaimer

As of today, this setup has been tested in the testnet only. 

We all stake at our own risk. Please always do the experiments and dry-run on the testnet first, familiarize yourself with all the operations, and harden your systems before running it on the mainnet. This guide serves as a stepping stone for staking with Kubernetes. **The authors are not responsible for any financial losses incurred by following this guide.**

## System Requirements

We need at least 3 machines (virtual machines or bare-metal machines) in total for this setup. One machine will be the NFS server to store the staking data, the second machine will be the “master” node to run the Kubernetes core components, and finally, the third machine will be the “worker” node to run the workloads, which are the beacon and validators, in the Kubernetes cluster. For high availability (HA), you can consider adding more nodes by following [MicroK8s’ High Availability documentation](https://microk8s.io/docs/high-availability) and regularly backing up the beacon data for fast startup. We will discuss HA configurations in subsequent posts. 

Here are the recommended system requirements based on our testing on the [**Pyrmont testnet**](https://pyrmont.beaconcha.in/) and MicroK8s’ [official documentation](https://microk8s.io/docs). Please note that meeting the minimal requirements does not guarantee optimal performance or cost efficiency. 

Master:

- RAM: 8GB
- CPU: 1 core minimum
- Disk: 20 GB minimum

Worker:

- RAM: 8GB minimum
- CPU: 1 core minimum
- Disk: 20 GB minimum

NFS:

- RAM: 2GB minimum
- CPU: 1 core minimum
- Disk: 250 GB minimum (Again, please note it is for testnet. For running on the mainnet, you may need more storage.)

## Prerequisites

- You have funded your validators and have generated validator keys. If you need guidance, we recommend [Somer Esat’s guide](https://someresat.medium.com/guide-to-staking-on-ethereum-2-0-ubuntu-pyrmont-lighthouse-a634d3b87393).
- Ethereum 1.0 “Goerli” node: [Somer Esat’s guide](https://someresat.medium.com/guide-to-staking-on-ethereum-2-0-ubuntu-pyrmont-prysm-a10b5129c7e3) also covers steps for building the Ethereum 1.0 node. You can also choose a third-party provider such as [Infura](https://infura.io/) or [Alchemy](https://alchemyapi.io/).
- Planning your private network, firewall, and port forwarding. We have put our network configuration in the [Walkthrough](#overview) for your reference.
- You have installed Ubuntu Server 20.04.2 LTS (x64) on all the servers and have assigned static IPs.

## Network Requirements

- Every machine needs to have outbound connectivity to the Internet at least during installation. 
- Masters and workers can reach to each other. We will configure the firewall in the following section to only allow the inbound traffic to the ports required by MicroK8s. For more details, you can refer to [MicroK8s’ documentation: Services and ports](https://microk8s.io/docs/ports).
- Masters and workers can reach the NFS server.
- Masters and workers can reach the endpoint of the Ethereum 1.0 node.

## Walkthrough

### Overview

In this walkthrough, we will set up a Kubernetes cluster and a NFS server and install the beacon node and the validator clients. We put all the machines in the same private subnet and have assigned a static private IP for each machine. Here are the network configurations we use throughout this guide for the three machines:

**Private subnet :172.20.0.0/20 (172.20.0.1 - 172.20.15.254)**
- NFS IP: 172.20.10.10
- Master IP: 172.20.10.11
- Worker IP: 172.20.10.12
- DNS: 8.8.8.8, 8.8.4.4 (Google’s DNS)

### System Update/Upgrade

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

4. Edit the configuration.

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

5. Restart the service.

    ```bash
    sudo systemctl restart chronyd
    ```

6. To see the source of synchronization data.

    ```bash
    chronyc sources
    ```

    To view the current status of chrony.

    ```bash
    chronyc tracking
    ```

### Configure Firewall

1. Set up default rules.

    ```bash
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    ```

2. (**Optional**) We suggest changing the ssh port from `22` to another port for security. You can open the `sshd_config` config file and change the port setting:

    ```bash
    sudo nano /etc/ssh/sshd_config
    ```

    Change `Port 22` to your designated port and then restart the ssh service.

    ```bash
    sudo service sshd restart
    ```

    No matter which port is used, remember to allow incoming traffic to your ssh port over TCP:

    ```bash
    sudo ufw allow <ssh-port>/tcp
    ```

3. On the NFS server, add the rule for NFS service:

    ```bash
    sudo ufw allow 2049/tcp
    ```

4. On the master and worker machines, add the rules for MicroK8s services:

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

5. On the master and worker machines, add the rules for beacon node:

    ```bash
    sudo ufw allow 12000/udp
    sudo ufw allow 13000/tcp
    ```

6. Lastly, enable the firewall on each machine.

    ```bash
    sudo ufw enable
    sudo ufw status numbered
    ```

### Install MicroK8s

To install MicroK8s, you can refer to [MicroK8s’ official installation guide](https://microk8s.io/docs) or follow the instructions below on both of the master and worker machines.

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

1. Enable DNS and Helm3.

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

### Install and Configure NFS

You can refer to the [guide for NFS installation and configuration on Ubuntu](https://ubuntu.com/server/docs/service-nfs) or follow the instructions below.

On the machine you plan to run NFS:

1. Install and start the NFS server.

    ```bash
    sudo apt install nfs-kernel-server
    sudo systemctl start nfs-kernel-server.service
    ```

2. Create directories for the beacon node, validators, and wallets.

    ```bash
    sudo mkdir -p /data/prysm/beacon

    sudo mkdir -p /data/prysm/validator-1 /data/prysm/wallet-1
    sudo mkdir -p /data/prysm/validator-2 /data/prysm/wallet-2
    ```

    Please note that each wallet can only be used by a single validator client. You can import multiple validator keys into the same wallet and use **one validator client** to attest/propose blocks for multiple validators. 
    
    *To avoid slashing, do not use multiple validator clients with the same wallet or have the same key imported into different wallets used by different validator clients.*

3. Configure and export NFS storage.

    ```bash
    sudo nano /etc/exports
    ```

    Add the following and save the file:

    ```bash
    /data *(rw,sync,no_subtree_check)
    ```

    Option descriptions:

    - **\***: hostname format.
    - **rw**: read/write permission.
    - **sync**: changes are guaranteed to be committed to stable storage before replying to requests.
    - **no_subtree_check**: disables subtree checking, which has mild security implications, but can improve reliability in some circumstances. From release 1.1.0 of nfs-utils onwards, the default is no_subtree_check as subtree_checking tends to cause more problems than it is worth.

    Please see the [NFS server export table manual](https://man7.org/linux/man-pages/man5/exports.5.html) for more details.

    Export the config

    ```bash
    sudo exportfs -a
    ```


On your master and worker nodes, enable NFS support by installing nfs-common:

```bash
sudo apt install nfs-common
```

### Prepare Validator Wallets

Please refer to Prysm’s [official documentation](https://docs.prylabs.network/docs/mainnet/joining-eth2/#step-4-import-your-validator-accounts-into-prysm).

Let’s get back to the NFS server. We need to configure the wallet directories that we created in the previous section. Before proceeding, please have your validator keys placed on your NFS machine. To create a wallet and import your validator keys for Prysm validator clients, we use Prysm’s startup script.

1. Please follow Prysm’s [documentation](https://docs.prylabs.network/docs/install/install-with-script/#downloading-the-prysm-startup-script) to download Prysm startup script.

2. Execute the startup script with `--keys-dir=<path/to/validator-keys>` (Remember to replace it with the directory you place the keys). We use `$HOME/eth2.0-deposit-cli/validator_keys` as the example path to the validator keys.

    ```bash
    sudo ./prysm.sh validator accounts import --keys-dir=$HOME/eth2.0-deposit-cli/validator_keys
    ```

3. When prompted, enter your wallet directory. For example, `/data/prysm/wallet-1`

4. Create the wallet password (**remember to back it up somewhere safe!**)

5. Enter the password you used to create the validator keys with the [eth2.0-deposit-cli](https://github.com/ethereum/eth2.0-deposit-cli). If you enter it correctly, the accounts will be imported into the new wallet.

### Change the owner of the data folder

On the NFS machine, let’s change the directory owners so later these directories can be mounted by Kubernetes as the storage volumes for the pods running the beacon node and the validator. 

```bash
sudo chown -R 1001:2000 /data # you can pick other user ID and group ID
```

### Prepare the Helm Chart

We understand it is not trivial to learn Kubernetes and create manifests or Helm charts for staking from scratch, so we’ve already done this for you to help you bootstrap! We uploaded all the manifests in our Github repository [eth2xk8s](https://github.com/eth2xk8s/eth2xk8s).

We use Helm to manage packages and releases in this guide. You can also use Kubernetes manifests directly. Please see [Testing with manifests and hostPath](https://github.com/eth2xk8s/eth2xk8s/blob/master/host-path/README.md) and [Testing with manifests and NFS](https://github.com/eth2xk8s/eth2xk8s/blob/master/nfs/README.md) for details.

1. Clone this repo.

    ```bash
    git clone https://github.com/eth2xk8s/eth2xk8s.git
    ```

2. Change values in [./eth2prysm/values.yaml](https://github.com/eth2xk8s/eth2xk8s/blob/master/eth2prysm/values.yaml).

    We recommend checking each field in `values.yaml` to determine the desired configuration. Fields that need to be changed or verified before installing the chart are the following ones:
    - **nfs.serverIp**: NFS server IP address.
    - **nfs.user**: The user ID is used to run all processes in the container that accesses the NFS.
    - **nfs.group**: The group ID is used to grant limited file access to the processes in the container.
    - **image.version**: Prysm client version.
    - **beacon.dataVolumePath**: The path to the data directory on the NFS for the beacon node.
    - **beacon.web3Provider** and **beacon.fallbackWeb3Providers**: Ethereum 1 node endpoints.
    - **validators.validator1.dataVolumePath**: The path to the data directory on the NFS for the validator.
    - **validators.validator1.walletVolumePath**: The path to the data directory on the NFS for the wallet.
    - **validators.validator1.walletPassword**: The wallet password.

### Install Prysm via Helm Chart

Kubernetes has the concept of [namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) to define scopes for names and isolate accesses between resources. We use `prysm` as the namespace for the Prysm client. 

Helm uses [releases](https://helm.sh/docs/glossary/#release) to track each of the chart installations. In this guide, we specify our release name as “eth2xk8s”, you can change it to anything you prefer.

On your master:

1. Create the namespace.

    ```bash
    microk8s kubectl create namespace prysm
    ```

2. Install the Prysm client.

    ```bash
    microk8s helm3 install eth2xk8s ./eth2prysm -nprysm
    ```

3. Check the configurations used.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nprysm
    ```

### Check Client Status

1. Check the deployment status.

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```

    This command will watch for changes. You can monitor it until the beacon node and validators are all in RUNNING status.

2. Check the log of the beacon node.

    ```bash
    microk8s kubectl logs -f -nprysm -lapp=beacon
    ```

3. Check the log of the first validator.

    ```bash
    microk8s kubectl logs -f -nprysm -lapp=validator1
    ```

    To check other validators, change -lapp to other validators’ names specified in `values.yaml`, *e.g.* for checking the second validator.

    ```bash
    microk8s kubectl logs -f -nprysm -lapp=validator2
    ```

### Upgrade the Prysm Version with Helm Chart

Ethereum 2.0 client teams work hard to push new versions frequently. Ideally, we should try to keep up with the new releases to get the up-to-date patches and features! We suggest using Helm for upgrading to leverage its releases and lifecycle management:

1. Check [Prysm Github release page](https://github.com/prysmaticlabs/prysm/releases) to get the latest release version.

2. Modify the `image.version` in `values.yaml` to the latest version, *e.g.* v1.3.4.

3. Save `values.yaml` and upgrade the client with the Helm upgrade command.

    ```bash
    microk8s helm3 upgrade eth2xk8s ./eth2prysm -nprysm
    ```

4. Check the configurations to see if it picks up the new version correctly.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nprysm
    ```

5. Refer to [Check Client Status](#check-client-status) section to verify the client is running without issues.

### Roll Back the Release with Helm

Rolling back with Helm is usually as straightforward as upgrading when there’s no database schema changes involved. You can follow the steps below: 

1. Check Helm release history and find a “good” release. Note the target revision number.

    ```bash
    microk8s helm3 history eth2xk8s -nprysm
    ```

2. If we want to roll back to revision 4,

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nprysm
    ```

3. Check the configurations used and refer to the [Check Client Status](#check-client-status) section to verify the client is running without issues.

If the rollback involves schema changes, please refer to [Appendix: Roll Back the Release with Helm (Schema Changes)](#roll-back-the-release-with-helm-schema-changes) for details.

Sometimes, it’s not possible to downgrade to previous versions like described [here](https://docs.prylabs.network/docs/prysm-usage/staying-up-to-date/#downgrading-between-major-version-bumps). Please refer to the client team’s documentations for details before you downgrade the client.

## Conclusion

Thank you for reading to the end of this guide! We hope this guide paves the way for staking with Kubernetes. We will continue to contribute more guides about staking with Kubernetes to the community. We are currently developing the Helm Chart and guides for other Ethereum 2.0 clients. Stay tuned!

## Feedback

We would love to hear from you! Let us know what you think.

- If you have any suggestions or questions regarding this guide, feel free to open issues or pull requests in our [website](https://github.com/lumostone/lumostone.github.io) repository.
- If you would like to contribute to the Helm Chart, open issues or pull requests in [eth2xk8s](https://github.com/eth2xk8s/eth2xk8s) repository.

## Appendix

### Check CPU / Memory Usage

You can use [metrics server](https://github.com/kubernetes-sigs/metrics-server) to check the CPU/Memory usage of each pod.

1. Install metrics server on the cluster:

    ```bash
    microk8s kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    ```

2. Run the `kubectl top` command, for example:

    ```bash
    microk8s kubectl top pod -l app=beacon
    kubectl top pod -l app=validator
    ```

### Uninstall Helm Chart

If you want to stop and uninstall the Prysm client, you can uninstall the Helm chart with the following command:

```bash
microk8s helm3 uninstall eth2xk8s -nprysm
```

### Roll Back the Release with Helm (Schema Changes)

Take [Prysm v1.3.0 release for example](https://github.com/prysmaticlabs/prysm/releases/tag/v1.3.0) as an example. If you decide to roll back to v1.2.x after upgrading to v1.3.0, you’ll need to run a script first to reverse the database migration. If we use instructions in [Roll Back the Release with Helm](#roll-back-the-release-with-helm) directly, the pods will restart right after the version is changed by Helm and the client might not run due to the unmatched schema.

Hence, we can take advantage of Kubernetes to help us temporarily scale down the pods and then to run the reverse migration script before rolling back.

1. Before rolling back the release, scale down the target deployment, *e.g*. scale down beacon node

    ```bash
    microk8s kubectl scale deployments/beacon -nprysm --replicas=0
    ```

    or scale down validator1 if the schema changes only affect validators

    ```bash
    microk8s kubectl scale deployments/validator1 -nprysm --replicas=0
    ```

2. Confirm that the pod(s) are terminated.

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```

3. Run the reverse migration script.

4. Roll back the release to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nprysm
    ```

5. Scale up the deployment.

    ```bash
    microk8s kubectl scale deployments/beacon -nprysm --replicas=1
    microk8s kubectl scale deployments/validator1 -nprysm --replicas=1
    ```

6. Confirm that the pod(s) are running.

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```
