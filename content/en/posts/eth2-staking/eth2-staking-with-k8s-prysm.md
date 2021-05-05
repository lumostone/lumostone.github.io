---
title: "Guide to Ethereum 2.0 Staking with Kubernetes and Prysm"
date: 2021-04-19T23:53:09Z
draft: false
tags: ["ethereum", "kubernetes", "tutorial"]
aliases: 
    - ../../eth2-staking-with-k8s-prysm/ # Original URL is baseURL/en/eth2-staking-with-k8s-prysm/
---

{{% includemd file="partials/_part1.md" %}}

### Install and Configure NFS

You can refer to the [Ubuntu's documentation: NFS installation and configuration](https://ubuntu.com/server/docs/service-nfs) or follow the instructions below.

On the machine you plan to run NFS:

1. Install and start the NFS server.

    ```bash
    sudo apt install nfs-kernel-server
    sudo systemctl start nfs-kernel-server.service
    ```

2. Create directories for the beacon node, validator clients, and wallets.

    ```bash
    sudo mkdir -p /data/prysm/beacon

    sudo mkdir -p /data/prysm/validator-client-1 /data/prysm/wallet-1
    sudo mkdir -p /data/prysm/validator-client-2 /data/prysm/wallet-2
    ```

   **Please note that each wallet can only be used by a single validator client.** You can import multiple validator keys into the same wallet and use one validator client to attest/propose blocks for multiple validators. 
    
    _To avoid slashing, do not use multiple validator clients with the same wallet or have the same key imported into different wallets used by different validator clients._

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

### Prepare Validator Wallets

Please refer to [Prysm’s documentation](https://docs.prylabs.network/docs/mainnet/joining-eth2/#step-4-import-your-validator-accounts-into-prysm).

Let’s get back to the NFS server. Before proceeding, please have your validator keys placed on your NFS machine. We are going to prepare the wallet with wallet directories that we created in the previous section, and then import the validator keys into the wallet. To create a wallet and import your validator keys for Prysm validator clients, we use Prysm’s startup script.

1. Please follow [Prysm’s documentation](https://docs.prylabs.network/docs/install/install-with-script/#downloading-the-prysm-startup-script) to download Prysm startup script.

2. Execute the startup script with `--keys-dir=<path/to/validator-keys>` (Remember to replace it with the directory you place the keys). We use `$HOME/eth2.0-deposit-cli/validator_keys` as the example path to the validator keys.

    ```bash
    sudo ./prysm.sh validator accounts import --keys-dir=$HOME/eth2.0-deposit-cli/validator_keys
    ```

3. When prompted, enter your wallet directory. For example, `/data/prysm/wallet-1`

4. Create the wallet password (**remember to back it up somewhere safe!**)

5. Enter the password you used to create the validator keys with the [eth2.0-deposit-cli](https://github.com/ethereum/eth2.0-deposit-cli). If you enter it correctly, the accounts will be imported into the new wallet.

### Change the owner of the data folder

On the NFS machine, let’s change the directory owners so later these directories can be mounted by Kubernetes as the storage volumes for the pods running the beacon node and the validator clients. 

```bash
sudo chown -R 1001:2000 /data # you can pick other user ID and group ID
```

### Prepare the Helm Chart

We understand it is not trivial to learn Kubernetes and create manifests or Helm Charts for staking from scratch, so we’ve already done this for you to help you bootstrap! We uploaded all the manifests in our Github repository [eth2xk8s](https://github.com/lumostone/eth2xk8s).

We use Helm to manage packages and releases in this guide. You can also use Kubernetes manifests directly. Please see [Testing manifests with Prysm and hostPath](https://github.com/lumostone/eth2xk8s/blob/master/prysm/host-path/README.md) and [Testing manifests with Prysm and NFS](https://github.com/lumostone/eth2xk8s/blob/master/prysm/nfs/README.md) for details.

1. Clone this repo.

    ```bash
    git clone https://github.com/lumostone/eth2xk8s.git
    ```

2. Change values in [./prysm/helm/values.yaml](https://github.com/lumostone/eth2xk8s/blob/master/prysm/helm/values.yaml).

    We recommend checking each field in `values.yaml` to determine the desired configuration. Fields that need to be changed or verified before installing the chart are the following ones:
    - **nfs.serverIp**: NFS server IP address.
    - **nfs.user**: The user ID will be used to run all processes in the container. The user should have the access to the mounted NFS volume.
    - **nfs.group**: The group ID will be used to run all processes in the container. The group should have the access to the mounted NFS volume. We use the group ID to grant limited file access to the processes so it won't use the root group directly.
    - **image.version**: Prysm client version.
    - **beacon.dataVolumePath**: The path to the data directory on the NFS for the beacon node.
    - **beacon.web3Provider** and **beacon.fallbackWeb3Providers**: Ethereum 1.0 node endpoints.
    - **validatorClients.validatorClient1.dataVolumePath**: The path to the data directory on the NFS for the validator client.
    - **validatorClients.validatorClient1.walletVolumePath**: The path to the data directory on the NFS for the wallet.
    - **validatorClients.validatorClient1.walletPassword**: The wallet password.

### Install Prysm via Helm Chart

Kubernetes has the concept of [namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) to define scopes for names and isolate accesses between resources. We use `prysm` as the namespace for the Prysm client. 

Helm uses [releases](https://helm.sh/docs/glossary/#release) to track each of the chart installations. In this guide, we specify our release name as `eth2xk8s`, you can change it to anything you prefer.

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

### Check Client Status

1. Check the deployment status.

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```

    This command will watch for changes. You can monitor it until the beacon node and validator clients are all in RUNNING status.

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

### Upgrade the Prysm Version with Helm Chart

Ethereum 2.0 client teams work hard to push new versions frequently. Ideally, we should try to keep up with the new releases to get the up-to-date patches and features! We suggest using Helm for upgrading to leverage its releases and lifecycle management:

1. Check [Prysm Github release page](https://github.com/prysmaticlabs/prysm/releases) to get the latest release version.

2. Modify the `image.version` in `values.yaml` to the latest version, *e.g.* `v1.3.4`, and save the change in `values.yaml`.

3. Upgrade the client with the Helm upgrade command.

    ```bash
    microk8s helm3 upgrade eth2xk8s ./prysm/helm -nprysm
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

2. If we want to roll back to revision 4

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
- If you would like to contribute to the Helm Chart, open issues or pull requests in [eth2xk8s](https://github.com/lumostone/eth2xk8s) repository.

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
    microk8s kubectl top pod -l app=validator-client-1
    ```

### Uninstall Helm Chart

If you want to stop and uninstall the Prysm client, you can uninstall the Helm Chart with the following command:

```bash
microk8s helm3 uninstall eth2xk8s -nprysm
```

### Roll Back the Release with Helm (Schema Changes)

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
