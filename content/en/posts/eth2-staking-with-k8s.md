---
title: "Guide to Ethereum 2.0 Staking with Kubernetes"
date: 2021-05-07T23:53:09Z
draft: true
tags: ["ethereum", "kubernetes", "tutorial"]
aliases: 
    - /en/eth2-staking-with-k8s-prysm/
---

> On May 10, 2021, this guide has been updated to include Lighthouse, Teku and Nimbus clients along with Prysm, the Ethereum 2.0 client we started with.

## Why Stake with Kubernetes?

As stakers, we all want to minimize downtime and the risk of being slashed.

Minimizing downtime is a difficult objective to achieve since a validator might be down for various reasons: system failures, incomplete restart policies, connectivity issues, hardware maintenance or software bugs. Staking with two or more machines for redundancy naturally comes to mind.

People might say, “redundancy leads to slashing!” which is a legitimate concern because we could accidentally run multiple validators with the same validator keys at the same time. Migrating the validators from a broken machine to the other with inappropriate procedure might in turn corrupt the slashing protection database . A staker with benign intention has the risk of being slashed due to the error-prone manual operations and the complexities increase when you have a high-availability setup. Needless to say, the experience could deteriorate if a staker runs multiple validators.

_Can we reduce the risk and the complexities of staking while running multiple validators and embracing redundancy?_ Yes, we think [Kubernetes](https://kubernetes.io/docs/concepts/overview/what-is-kubernetes/) can help us manage the application’s lifecycle and automate the upgrade rollouts. The process of upgrading a client would be completed in one-step. Furthermore, migrating a client from one machine to another also would be a single command (*e.g.* kubectl drain node).

We hope this experiment and the setup guide can be a stepping stone for the community to stake with Kubernetes for Ethereum 2.0. Embrace the redundancy and stake with ease and scalability.

## Acknowledgement

We want to thank Ethereum Foundation for supporting this project via the [Eth2 Staking Community Grants](https://blog.ethereum.org/2021/02/09/esp-staking-community-grantee-announcement/). It’s an honor to contribute to this community!

## Technologies

In this step-by-step guide, we run multiple Ethereum 2.0 clients in a Kuberenetes cluster for staking. We are using:

- Ethereum 2.0 Client ([Prysm](https://github.com/prysmaticlabs/prysm), [Lighthouse](https://github.com/sigp/lighthouse), [Teku](https://github.com/ConsenSys/teku) or [Nimbus](https://github.com/status-im/nimbus-eth2))
- [MicroK8s](https://microk8s.io/) as the Kubernertes destribution ([installation guide](https://microk8s.io/docs)).
- [Helm 3](https://helm.sh/) to manage packages and releases.
- [kubectl](https://kubernetes.io/docs/reference/kubectl/overview/) to run commands against Kubernetes clusters.
- Ubuntu Server 20.04.2 LTS (x64) ([download link](https://ubuntu.com/download/server)).
- [Network File System (NFS)](https://en.wikipedia.org/wiki/Network_File_System) as beacon and validator clients’ persistent storage ([Guide for NFS installation and configuration on Ubuntu](https://ubuntu.com/server/docs/service-nfs)).
- [eth2xk8s](https://github.com/lumostone/eth2xk8s) Helm Chart.

## Goal

This guide will help you to:

- Create a Kubernetes cluster with MicroK8s. If you already have your preferred Kubernetes distribution running you can jump to the section “[Install and Configure NFS](#install-and-configure-nfs)”. If you are using managed Kubernetes services provided by cloud providers (*e.g.* AKS, EKS, and GKE), you may consider using cloud storage directly rather than NFS as the persistent storage. We will cover this topic in the future.
- Install and configure NFS.
- Prepare the Helm Chart for multiple clients.
- Install Ethereum 2.0 clients with the Helm Chart.
- Check client status.
- Upgrade and roll back the Ethereum 2.0 clients with the Helm Chart.

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

- You have funded your validators and have generated validator keys. If you need guidance, we recommend [Somer Esat’s guide](https://medium.com/search?q=someresat%20Guide%20to%20Staking).
- Ethereum 1.0 “Goerli” node: [Somer Esat’s guide](https://medium.com/search?q=someresat%20Guide%20to%20Staking) also covers steps for building the Ethereum 1.0 node. You can also choose a third-party provider such as [Infura](https://infura.io/) or [Alchemy](https://alchemyapi.io/).
- Planning your private network, firewall, and port forwarding. We have put our network configuration in the [Walkthrough](#overview) for your reference.
- You have installed Ubuntu Server 20.04.2 LTS (x64) on all the servers and have assigned static IPs.

## Walkthrough

### Choose Your Ethereum 2.0 Client

The content of the following guide will be changed based on your client selection. Please choose the one your prefer before continue reading:
{{< content-toggle toggleTotal="4" toggle1="Prysm" toggle2="Lighthouse" toggle3="Teku" toggle4="Nimbus" active="toggle1" >}}

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
{{< toggle-panel name="Prysm" active=true >}}

```bash
sudo ufw allow 12000/udp
sudo ufw allow 13000/tcp
```

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

```bash
sudo ufw allow 9000
```

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

```bash
sudo ufw allow 9000
```

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

```bash
sudo ufw allow 9000
```

{{< /toggle-panel >}}

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

### Install and Configure NFS

You can refer to the [Ubuntu's documentation: NFS installation and configuration](https://ubuntu.com/server/docs/service-nfs) or follow the instructions below.

On the machine you plan to run NFS:

1. Install and start the NFS server.

    ```bash
    sudo apt install nfs-kernel-server
    sudo systemctl start nfs-kernel-server.service
    ```

{{< toggle-panel name="Prysm" active=true >}}

2. Create directories for the beacon node, validator clients, and wallets.

    ```bash
    sudo mkdir -p /data/prysm/beacon

    sudo mkdir -p /data/prysm/validator-client-1 /data/prysm/wallet-1
    sudo mkdir -p /data/prysm/validator-client-2 /data/prysm/wallet-2
    ```

    **Please note that each wallet can only be used by a single validator client.** You can import multiple validator keys into the same wallet and use one validator client to attest/propose blocks for multiple validator keys.

    _To avoid slashing, do not use multiple validator clients with the same wallet or have the same key imported into different wallets used by different validator clients._

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

2. Create directories for the beacon node and validator clients.

    ```bash
    sudo mkdir -p /data/lighthouse/beacon

    sudo mkdir -p /data/lighthouse/validator-client-1
    sudo mkdir -p /data/lighthouse/validator-client-2
    ```

    **Please note that each key can only be used by a single validator client.** You can import multiple validator keys into the same validator client and attest/propose blocks for multiple validator keys.

    _To avoid slashing, do not import the same key into different validator clients._

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

2. Create directories for the beacon node, validator clients, validator keys and key passwords.

    ```bash
    sudo mkdir -p /data/teku/beacon

    sudo mkdir -p /data/teku/validator-client-1 /data/teku/validator-keys-1 /data/teku/validator-key-passwords-1
    sudo mkdir -p /data/teku/validator-client-2 /data/teku/validator-keys-2 /data/teku/validator-key-passwords-2
    ```

    **Please note that each key can only be used by a single validator client.** You can import multiple validator keys into the same validator client and attest/propose blocks for multiple validator keys.

    _To avoid slashing, do not import the same key into different validator clients._

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

2. Create directories for the beacon node, validators and secrets.

    ```bash
    sudo mkdir -p /data/nimbus/beacon-1 /data/nimbus/validators-1 /data/nimbus/secrets-1
    sudo mkdir -p /data/nimbus/beacon-2 /data/nimbus/validators-2 /data/nimbus/secrets-2
    ```

    **Please note that each key can only be used by a single Nimbus client.** You can import multiple validator keys into the same client and attest/propose blocks for multiple validator keys.

    _To avoid slashing, do not import the same key into different Nimbus clients._

{{< /toggle-panel >}}

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

4. On your master and worker nodes, enable NFS support by installing `nfs-common`:

    ```bash
    sudo apt install nfs-common
    ```

### Import Validator Keys

Let’s get back to the NFS server to import the validator keys created with [eth2.0-deposit-cli](https://github.com/ethereum/eth2.0-deposit-cli). Before proceeding, please have your validator keys placed on your NFS machine.
{{< toggle-panel name="Prysm" active=true >}}

Please refer to [Prysm’s documentation](https://docs.prylabs.network/docs/mainnet/joining-eth2/#step-4-import-your-validator-accounts-into-prysm) about how to import your validator accounts into Prysm or follow the instructions below.

1. Please follow [Prysm’s documentation](https://docs.prylabs.network/docs/install/install-with-script/#downloading-the-prysm-startup-script) to download Prysm startup script.

2. Execute the startup script with `--keys-dir=<path/to/validator-keys>` (Remember to replace it with the directory you place the keys). We use `$HOME/eth2.0-deposit-cli/validator_keys` as the example path to the validator keys.

    ```bash
    sudo ./prysm.sh validator accounts import --keys-dir=$HOME/eth2.0-deposit-cli/validator_keys --prater
    ```

3. When prompted, enter your wallet directory. For example, `/data/prysm/wallet-1`

4. Create the wallet password (**remember to back it up somewhere safe!**)

5. Enter the password you used to create the validator keys with the `eth2.0-deposit-cli`. If you enter it correctly, the accounts will be imported into the new wallet.

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

Please refer to [Lighthouse's documentation](https://lighthouse-book.sigmaprime.io/validator-import-launchpad.html) about how to import your validator accounts into Lighthouse or follow the instructions below.

1. Please follow [Lighthouse's documentation](https://lighthouse-book.sigmaprime.io/installation-binaries.html) to download Lighthouse pre-built binary.

2. Execute the binary with `--directory=<path/to/validator-keys>` (Remember to replace it with the directory you place the keys). We use `$HOME/eth2.0-deposit-cli/validator_keys` as the example path to the validator keys and `/data/lighthouse/validator-client-1` for the data directory of the validator client.

    ```bash
    sudo ./lighthouse --network prater account validator import --directory $HOME/eth2.0-deposit-cli/validator_keys --datadir /data/lighthouse/validator-client-1 --reuse-password
    ```

3. Enter the password you used to create the validator keys with `eth2.0-deposit-cli`. If you enter it correctly, the keys will be imported.

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

Please refer to [Teku's documentation](https://docs.teku.consensys.net/en/latest/HowTo/Get-Started/Connect/Connect-To-Testnet/#generate-the-validators-and-send-the-deposits) about how to import your validator accounts into Teku or follow the instructions below.

1. Copy validator keys into the target folder for keys. Assume our keys generated with `eth2.0-deposit-cli` is under `$HOME/eth2.0-deposit-cli/validator_keys` and our target folder for keys is `/data/teku/validator-keys-1`

    ```bash
    sudo cp  $HOME/eth2.0-deposit-cli/validator_keys/* /data/teku/validator-keys-1/
    ```

2. Create one password txt file for each corresponding key in the target folder for key passwords (assume it's `/data/teku/validator-key-passwords-1`). For example, if there's a keystore named `keystore-m_123.json`, you'll need to create a file named `keystore-m_123.txt` and store the keystore's password in it.

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

Please refer to [Nimbus's documentation](https://nimbus.guide/keys.html) about how to import your validator accounts into Nimbus or follow the instructions below.

1. Please follow [Nimbus's documentation](https://nimbus.guide/binaries.html) to download Nimbus pre-built binary.

2. Execute the binary with the directory you place the keys. We use `$HOME/eth2.0-deposit-cli/validator_keys` as the example path to the validator keys and `/data/nimbus-1` for the data directory of the Nimbus client.

    ```bash
    sudo nimbus_beacon_node deposits import --data-dir=/data/nimbus-1 $HOME/eth2.0-deposit-cli/validator_keys
    ```

3. Enter the password you used to create the validator keys with `eth2.0-deposit-cli`. If you enter it correctly, the keys will be imported.

{{< /toggle-panel >}}

### Change the owner of the data folder

On the NFS machine, let’s change the directory owners so later these directories can be mounted by Kubernetes as the storage volumes for the pods running the beacon node and the validator clients. 

```bash
sudo chown -R 1001:2000 /data # you can pick other user ID and group ID
```

### Prepare the Helm Chart

We understand it is not trivial to learn Kubernetes and create manifests or Helm Charts for staking from scratch, so we’ve already done this for you to help you bootstrap! We uploaded all the manifests in our Github repository [eth2xk8s](https://github.com/lumostone/eth2xk8s).

We use Helm to manage packages and releases in this guide. You can also use Kubernetes manifests directly. Please see [Testing manifests with hostPath](https://github.com/lumostone/eth2xk8s/blob/master/testing-with-host-path.md) and [Testing manifests with NFS](https://github.com/lumostone/eth2xk8s/blob/master/testing-with-nfs.md) for details.

1. Clone this repo.

    ```bash
    git clone https://github.com/lumostone/eth2xk8s.git
    ```

{{< toggle-panel name="Prysm" active=true >}}

2. Change values in [prysm/helm/values.yaml](https://github.com/lumostone/eth2xk8s/blob/master/prysm/helm/values.yaml).

    We recommend checking each field in `values.yaml` to determine the desired configuration. Fields that need to be changed or verified before installing the chart are the following ones:
    - **nfs.serverIp**: NFS server IP address.
    - **securityContext.runAsUser**: The user ID will be used to run all processes in the container. The user should have the access to the mounted NFS volume.
    - **securityContext.runAsGroup**: The group ID will be used to run all processes in the container. The group should have the access to the mounted NFS volume. We use the group ID to grant limited file access to the processes so it won't use the root group directly.
    - **image.versionTag**: Prysm client version.
    - **beacon.dataVolumePath**: The path to the data directory on the NFS for the beacon node.
    - **beacon.web3Provider** and **beacon.fallbackWeb3Providers**: Ethereum 1.0 node endpoints.
    - **validatorClients.validatorClient1**
      - **.dataVolumePath**: The path to the data directory on the NFS for the validator client.
      - **.walletVolumePath**: The path to the data directory on the NFS for the wallet.
      - **.walletPassword**: The wallet password.

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

2. Change values in [lighthouse/helm/values.yaml](https://github.com/lumostone/eth2xk8s/blob/master/lighthouse/helm/values.yaml).

    We recommend checking each field in `values.yaml` to determine the desired configuration. Fields that need to be changed or verified before installing the chart are the following ones:
    - **nfs.serverIp**: NFS server IP address.
    - **securityContext.runAsUser**: The user ID will be used to run all processes in the container. The user should have the access to the mounted NFS volume.
    - **securityContext.runAsGroup**: The group ID will be used to run all processes in the container. The group should have the access to the mounted NFS volume. We use the group ID to grant limited file access to the processes so it won't use the root group directly.
    - **image.versionTag**: Lighthouse client version.
    - **beacon.dataVolumePath**: The path to the data directory on the NFS for the beacon node.
    - **beacon.eth1Endpoints**: Ethereum 1.0 node endpoints.
    - **validatorClients.validatorClient1.dataVolumePath**: The path to the data directory on the NFS for the validator client.

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

2. Change values in [teku/helm/values.yaml](https://github.com/lumostone/eth2xk8s/blob/master/teku/helm/values.yaml).

    We recommend checking each field in `values.yaml` to determine the desired configuration. Fields that need to be changed or verified before installing the chart are the following ones:
    - **nfs.serverIp**: NFS server IP address.
    - **securityContext.runAsUser**: The user ID will be used to run all processes in the container. The user should have the access to the mounted NFS volume.
    - **securityContext.runAsGroup**: The group ID will be used to run all processes in the container. The group should have the access to the mounted NFS volume. We use the group ID to grant limited file access to the processes so it won't use the root group directly.
    - **image.versionTag**: Teku client version.
    - **beacon.dataVolumePath**: The path to the data directory on the NFS for the beacon node.
    - **beacon.eth1Endpoint**: Ethereum 1.0 node endpoint.
    - **validatorClients.validatorClient1**
      - **.dataVolumePath**: The path to the data directory on the NFS for the validator client.
      - **.validatorKeysVolumePath**: The path to the data directory on the NFS for the validator keys.
      - **.validatorKeyPasswordsVolumePath**: The path to the data directory on the NFS for the validator key passwords.

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

2. Change values in [nimbus/helm/values.yaml](https://github.com/lumostone/eth2xk8s/blob/master/nimbus/helm/values.yaml).

    We recommend checking each field in `values.yaml` to determine the desired configuration. Fields that need to be changed or verified before installing the chart are the following ones:
    - **nfs.serverIp**: NFS server IP address.
    - **securityContext.runAsUser**: The user ID will be used to run all processes in the container. The user should have the access to the mounted NFS volume.
    - **securityContext.runAsGroup**: The group ID will be used to run all processes in the container. The group should have the access to the mounted NFS volume. We use the group ID to grant limited file access to the processes so it won't use the root group directly.
    - **image.versionTag**: Nimbus client version.
    - **nimbus.clients.client1**
      - **.web3Provider** and **.fallbackWeb3Providers**: Ethereum 1.0 node endpoints.
      - **.dataVolumePath**: The path to the data directory on the NFS for the beacon node.
      - **.validatorsVolumePath**: The path to the data directory on the NFS for the validator keystores.
      - **.secretsVolumePath**: The path to the data directory on the NFS for the validator keystore passwords.

{{< /toggle-panel >}}

### Install Ethereum 2.0 Client via Helm Chart

Helm uses [releases](https://helm.sh/docs/glossary/#release) to track each of the chart installations. In this guide, we specify our release name as `eth2xk8s`, you can change it to anything you prefer. We'll install the Helm Chart in a [namespace](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/), which defines scopes for names and isolates accesses between resources.

{{< toggle-panel name="Prysm" active=true >}}
We use `prysm` as the namespace for the Prysm client.

On your master:

1. Create the namespace.

    ```bash
    microk8s kubectl create namespace prysm
    ```

2. Install the Prysm client.

    ```bash
    microk8s helm3 install eth2xk8s ./prysm/helm -nprysm
    ```

3. Check the configurations used.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nprysm
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}
We use `lighthouse` as the namespace for the Lighthouse client.

On your master:

1. Create the namespace.

    ```bash
    microk8s kubectl create namespace lighthouse
    ```

2. Install the Lighthouse client.

    ```bash
    microk8s helm3 install eth2xk8s ./lighthouse/helm -nlighthouse
    ```

3. Check the configurations used.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nlighthouse
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}
We use `teku` as the namespace for the Teku client.

On your master:

1. Create the namespace.

    ```bash
    microk8s kubectl create namespace teku
    ```

2. Install the Teku client.

    ```bash
    microk8s helm3 install eth2xk8s ./teku/helm -nteku
    ```

3. Check the configurations used.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nteku
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}
We use `nimbus` as the namespace for the Nimbus client.

On your master:

1. Create the namespace.

    ```bash
    microk8s kubectl create namespace nimbus
    ```

2. Install the Nimbus client.

    ```bash
    microk8s helm3 install eth2xk8s ./nimbus/helm -nnimbus
    ```

3. Check the configurations used.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nnimbus
    ```

{{< /toggle-panel >}}

### Check Client Status

{{< toggle-panel name="Prysm" active=true >}}

1. Check the deployment status.

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```

    This command will watch for changes. You can monitor it until the beacon node and validator clients are all in `Running` status.

2. Check the log of the beacon node.

    ```bash
    microk8s kubectl logs -f -nprysm -l app=beacon
    ```

3. Check the log of the first validator client.

    ```bash
    microk8s kubectl logs -f -nprysm -l app=validator-client-1
    ```

    To check other validator clients, change `-l app=<validator client name>` to other validator clients’ names specified in `values.yaml`, *e.g.* for checking the second validator client.

    ```bash
    microk8s kubectl logs -f -nprysm -l app=validator-client-2
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

1. Check the deployment status.

    ```bash
    microk8s kubectl get pod -nlighthouse -w
    ```

    This command will watch for changes. You can monitor it until the beacon node and validator clients are all in `Running` status.

2. Check the log of the beacon node.

    ```bash
    microk8s kubectl logs -f -nlighthouse -l app=beacon
    ```

3. Check the log of the first validator client.

    ```bash
    microk8s kubectl logs -f -nlighthouse -l app=validator-client-1
    ```

    To check other validator clients, change `-l app=<validator client name>` to other validator clients’ names specified in `values.yaml`, *e.g.* for checking the second validator client.

    ```bash
    microk8s kubectl logs -f -nlighthouse -l app=validator-client-2
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

1. Check the deployment status.

    ```bash
    microk8s kubectl get pod -nteku -w
    ```

    This command will watch for changes. You can monitor it until the beacon node and validator clients are all in `Running` status.

2. Check the log of the beacon node.

    ```bash
    microk8s kubectl logs -f -nteku -l app=beacon
    ```

3. Check the log of the first validator client.

    ```bash
    microk8s kubectl logs -f -nteku -l app=validator-client-1
    ```

    To check other validator clients, change `-l app=<validator client name>` to other validator clients’ names specified in `values.yaml`, *e.g.* for checking the second validator client.

    ```bash
    microk8s kubectl logs -f -nteku -l app=validator-client-2
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

1. Check the deployment status.

    ```bash
    microk8s kubectl get pod -nnimbus -w
    ```

    This command will watch for changes. You can monitor it until the clients are all in `Running` status.

2. Check the log of the first Nimbus client.

    ```bash
    microk8s kubectl logs -f -nnimbus -l app=nimbus-1
    ```

    To check other Nimbus clients, change `-l app=<nimbus client name>` to other Nimbus clients’ names specified in `values.yaml`, *e.g.* for checking the second Nimbus client.

    ```bash
    microk8s kubectl logs -f -nnimbus -l app=nimbus-2
    ```

{{< /toggle-panel >}}

### Upgrade the Ethereum 2.0 Client Version with Helm Chart

Ethereum 2.0 client teams work hard to push new versions frequently. Ideally, we should try to keep up with the new releases to get the up-to-date patches and features! We suggest using Helm for upgrading to leverage its releases and lifecycle management:

{{< toggle-panel name="Prysm" active=true >}}

1. Check [Prysm Github release page](https://github.com/prysmaticlabs/prysm/releases) to get the latest release version.

2. Modify the `image.versionTag` in `values.yaml` to the latest version, *e.g.* `v1.3.4`, and save the change in `values.yaml`.

3. Upgrade the client with the Helm upgrade command.

    ```bash
    microk8s helm3 upgrade eth2xk8s ./prysm/helm -nprysm
    ```

4. Check the configurations to see if it picks up the new version correctly.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nprysm
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

1. Check [Lighthouse Github release page](https://github.com/sigp/lighthouse/releases) to get the latest release version.

2. Modify the `image.versionTag` in `values.yaml` to the latest version, *e.g.* `v1.3.0`, and save the change in `values.yaml`.

3. Upgrade the client with the Helm upgrade command.

    ```bash
    microk8s helm3 upgrade eth2xk8s ./lighthouse/helm -nlighthouse
    ```

4. Check the configurations to see if it picks up the new version correctly.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nlighthouse
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

1. Check [Teku Github release page](https://github.com/ConsenSys/teku/releases) to get the latest release version.

2. Modify the `image.versionTag` in `values.yaml` to the latest version, *e.g.* `21.4.1`, and save the change in `values.yaml`.

3. Upgrade the client with the Helm upgrade command.

    ```bash
    microk8s helm3 upgrade eth2xk8s ./teku/helm -nteku
    ```

4. Check the configurations to see if it picks up the new version correctly.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nteku
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

1. Check [Nimbus Github release page](https://github.com/status-im/nimbus-eth2/releases) to get the latest release version.

2. Modify the `image.versionTag` in `values.yaml` to the latest version, *e.g.* `amd64-v1.2.1`, and save the change in `values.yaml`.

3. Upgrade the client with the Helm upgrade command.

    ```bash
    microk8s helm3 upgrade eth2xk8s ./nimbus/helm -nnimbus
    ```

4. Check the configurations to see if it picks up the new version correctly.

    ```bash
    microk8s helm3 get manifest eth2xk8s -nnimbus
    ```

{{< /toggle-panel >}}

5. Refer to [Check Client Status](#check-client-status) section to verify the client is running without issues.

### Roll Back the Release with Helm

If the rollback involves schema changes, please refer to [Appendix: Roll Back the Release with Helm (Schema Changes)](#roll-back-the-release-with-helm-schema-changes) for details. Otherwise, rolling back with Helm is usually as straightforward as upgrading when there’s no database schema changes involved. You can follow the steps below:

{{< toggle-panel name="Prysm" active=true >}}

1. Check Helm release history and find a “good” release. Note the target revision number.

    ```bash
    microk8s helm3 history eth2xk8s -nprysm
    ```

2. If we want to roll back to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nprysm
    ```

3. Check the configurations used and refer to the [Check Client Status](#check-client-status) section to verify the client is running without issues.

Sometimes, it’s not possible to downgrade to previous versions like described [here](https://docs.prylabs.network/docs/prysm-usage/staying-up-to-date/#downgrading-between-major-version-bumps). Please refer to the client team’s documentations for details before you downgrade the client.

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

1. Check Helm release history and find a “good” release. Note the target revision number.

    ```bash
    microk8s helm3 history eth2xk8s -nlighthouse
    ```

2. If we want to roll back to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nlighthouse
    ```

3. Check the configurations used and refer to the [Check Client Status](#check-client-status) section to verify the client is running without issues.

Sometimes, it’s not possible to downgrade to previous versions. Please refer to the client team’s documentations for details before you downgrade the client.

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

1. Check Helm release history and find a “good” release. Note the target revision number.

    ```bash
    microk8s helm3 history eth2xk8s -nteku
    ```

2. If we want to roll back to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nteku
    ```

3. Check the configurations used and refer to the [Check Client Status](#check-client-status) section to verify the client is running without issues.

Sometimes, it’s not possible to downgrade to previous versions. Please refer to the client team’s documentations for details before you downgrade the client.

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

1. Check Helm release history and find a “good” release. Note the target revision number.

    ```bash
    microk8s helm3 history eth2xk8s -nnimbus
    ```

2. If we want to roll back to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nnimbus
    ```

3. Check the configurations used and refer to the [Check Client Status](#check-client-status) section to verify the client is running without issues.

Sometimes, it’s not possible to downgrade to previous versions. Please refer to the client team’s documentations for details before you downgrade the client.

{{< /toggle-panel >}}

## Conclusion

Thank you for reading to the end of this guide! We hope this guide paves the way for staking with Kubernetes. We will continue to contribute more guides about staking with Kubernetes to the community. Stay tuned!

## Feedback

We would love to hear from you! Let us know what you think.

- If you have any suggestions or questions regarding this guide, feel free to open issues or pull requests in our [website](https://github.com/lumostone/lumostone.github.io) repository.
- If you would like to contribute to the Helm Chart, open issues or pull requests in [eth2xk8s](https://github.com/lumostone/eth2xk8s) repository.

## Appendix

### Check CPU / Memory Usage

You can use [metrics server](https://github.com/kubernetes-sigs/metrics-server) to check the CPU/Memory usage of each pod.

1. Install metrics server on the cluster:

    ```bash
    microk8s kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    ```

2. Run the `kubectl top` command, for example:
{{< toggle-panel name="Prysm" active=true >}}

```bash
microk8s kubectl top pod -l app=beacon
microk8s kubectl top pod -l app=validator-client-1
```

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

```bash
microk8s kubectl top pod -l app=beacon
microk8s kubectl top pod -l app=validator-client-1
```

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

```bash
microk8s kubectl top pod -l app=beacon
microk8s kubectl top pod -l app=validator-client-1
```

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

```bash
microk8s kubectl top pod -l app=nimbus-1
```

{{< /toggle-panel >}}

### Uninstall Helm Chart

If you want to stop and uninstall the Ethereum 2.0 client, you can uninstall the Helm Chart with the following command:

{{< toggle-panel name="Prysm" active=true >}}

```bash
microk8s helm3 uninstall eth2xk8s -nprysm
```

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

```bash
microk8s helm3 uninstall eth2xk8s -nlighthouse
```

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

```bash
microk8s helm3 uninstall eth2xk8s -nteku
```

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

```bash
microk8s helm3 uninstall eth2xk8s -nnimbus
```

{{< /toggle-panel >}}

### Roll Back the Release with Helm (Schema Changes)

{{< toggle-panel name="Prysm" active=true >}}

Take [Prysm v1.3.0 release](https://github.com/prysmaticlabs/prysm/releases/tag/v1.3.0) as an example. If you decide to roll back to v1.2.x after upgrading to v1.3.0, you’ll need to run a script first to reverse the database migration. If we use instructions in [Roll Back the Release with Helm](#roll-back-the-release-with-helm) directly, the pods will restart right after the version is changed by Helm and the client might not run due to the unmatched schema.

Hence, we can take advantage of Kubernetes to help us temporarily scale down the pods and then to run the reverse migration script before rolling back.

1. Before rolling back the release, scale down the target deployment, *e.g*. scale down beacon node

    ```bash
    microk8s kubectl scale deployments/beacon -nprysm --replicas=0
    ```

    or scale down validator-client-1 if the schema changes only affect validators

    ```bash
    microk8s kubectl scale deployments/validator-client-1 -nprysm --replicas=0
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
    microk8s kubectl scale deployments/validator-client-1 -nprysm --replicas=1
    ```

6. Confirm that the pod(s) are running.

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Lighthouse" >}}

If you decide to downgrade the client version but there's schema change due to version upgrade, you might be able to use tools provided by the client team to reserve the database migration. If we use instructions in [Roll Back the Release with Helm](#roll-back-the-release-with-helm) directly, the pods will restart right after the version is changed by Helm and the client might not run due to the unmatched schema.

Hence, we can take advantage of Kubernetes to help us temporarily scale down the pods and then to run the reverse migration tool (if any) before rolling back.

1. Before rolling back the release, scale down the target deployment, *e.g*. scale down beacon node

    ```bash
    microk8s kubectl scale deployments/beacon -nlighthouse --replicas=0
    ```

    or scale down validator-client-1 if the schema changes only affect validators

    ```bash
    microk8s kubectl scale deployments/validator-client-1 -nlighthouse --replicas=0
    ```

2. Confirm that the pod(s) are terminated.

    ```bash
    microk8s kubectl get pod -nlighthouse -w
    ```

3. Reverse database migration.

4. Roll back the release to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nlighthouse
    ```

5. Scale up the deployment.

    ```bash
    microk8s kubectl scale deployments/beacon -nlighthouse --replicas=1
    microk8s kubectl scale deployments/validator-client-1 -nlighthouse --replicas=1
    ```

6. Confirm that the pod(s) are running.

    ```bash
    microk8s kubectl get pod -nlighthouse -w
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Teku" >}}

If you decide to downgrade the client version but there's schema change due to version upgrade, you might be able to use tools provided by the client team to reserve the database migration. If we use instructions in [Roll Back the Release with Helm](#roll-back-the-release-with-helm) directly, the pods will restart right after the version is changed by Helm and the client might not run due to the unmatched schema.

Hence, we can take advantage of Kubernetes to help us temporarily scale down the pods and then to run the reverse migration tool (if any) before rolling back.

1. Before rolling back the release, scale down the target deployment, *e.g*. scale down beacon node

    ```bash
    microk8s kubectl scale deployments/beacon -nteku --replicas=0
    ```

    or scale down validator-client-1 if the schema changes only affect validators

    ```bash
    microk8s kubectl scale deployments/validator-client-1 -nteku --replicas=0
    ```

2. Confirm that the pod(s) are terminated.

    ```bash
    microk8s kubectl get pod -nteku -w
    ```

3. Reverse database migration.

4. Roll back the release to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nteku
    ```

5. Scale up the deployment.

    ```bash
    microk8s kubectl scale deployments/beacon -nteku --replicas=1
    microk8s kubectl scale deployments/validator-client-1 -nteku --replicas=1
    ```

6. Confirm that the pod(s) are running.

    ```bash
    microk8s kubectl get pod -nteku -w
    ```

{{< /toggle-panel >}}
{{< toggle-panel name="Nimbus" >}}

If you decide to downgrade the client version but there's schema change due to version upgrade, you might be able to use tools provided by the client team to reserve the database migration. If we use instructions in [Roll Back the Release with Helm](#roll-back-the-release-with-helm) directly, the pods will restart right after the version is changed by Helm and the client might not run due to the unmatched schema.

Hence, we can take advantage of Kubernetes to help us temporarily scale down the pods and then to run the reverse migration tool (if any) before rolling back.

1. Before rolling back the release, scale down the target deployment, *e.g*. scale down beacon node

    ```bash
    microk8s kubectl scale deployments/nimbus-1 -nnimbus --replicas=0
    ```

2. Confirm that the pod(s) are terminated.

    ```bash
    microk8s kubectl get pod -nnimbus -w
    ```

3. Reverse database migration.

4. Roll back the release to revision 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nnimbus
    ```

5. Scale up the deployment.

    ```bash
    microk8s kubectl scale deployments/nimbus-1 -nnimbus --replicas=1
    ```

6. Confirm that the pod(s) are running.

    ```bash
    microk8s kubectl get pod -nnimbus -w
    ```

{{< /toggle-panel >}}
