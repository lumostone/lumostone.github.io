---
title: "當以太幣質押挖礦機遇見 Kubernetes－架設教學"
date: 2021-04-19T23:53:09Z
draft: false
tags: ["以太坊", "kubernetes", "教學"]
---

## 為什麼使用 Kubernetes 作 staking？
作為 staker，我們常擔憂 validator 是否會突然停機，或是被區塊鏈上其他節點認作是壞成員而遭到驅逐（slashing）。如何最小化停機時間和降低被驅逐的風險，成為了一個 staker 時常考慮的問題。

停機的原因百百種，可能是系統需要執行更新，軟體有問題，網路斷線，硬碟罷工等等。我們都希望可以時時監控，一旦有問題發生就立刻處理，但問題可大可小，不是每一次都能很快修復，除非是全職 staking，不然一般也沒辦法二十四小時監控處理。面對這種有高可用性的需求情境時，我們很自然地會想到 redundancy，如果怕一台機器停工，那我就再多準備幾台機器，一旦有問題就可以把系統轉移到健康的機器。

然而，我們常在論壇上看到 staker 們彼此警告「redundancy 可能會導致 slashing」，因為在轉移系統的過程，可能會因為手動操作疏失，不小心讓多個 validator 用戶端同時使用同一個 validator 金鑰，或是 slashing protection database 移轉時資料毀損，新的 validator 太快上線，又重新上傳了已經驗證過的區塊等等，這些都會讓 validator 面臨 slashing 的懲罰。當我們有多個 validator ，又同時想要追求 redundancy、高可用性，這些維運複雜度就會跟著上升，追求 redundancy 反而產生更多 slashing 的風險。

**我們有可能降低 slashing 風險跟維運複雜度，同時又能擁抱 redundancy 帶給我們的好處嗎？** 有的！我們認為 [Kubernetes](https://kubernetes.io/docs/concepts/overview/what-is-kubernetes/) 可以幫我們做到這件事，運用 Kubernetes 管理 validator 的生命週期，自動化容錯移轉（failover），在軟體更新時，只需要更改版本號，Kubernetes 就可以幫我們安全升級，今天硬體要更新，要手動移轉 validator 時，僅用一個指令便能完成（例如：`kubectl drain node`）。 

我們希望這篇教學文章可以作為以太坊 2.0 staker community 的墊腳石，讓 stakers 可以利用 Kubernetes 建立一個有擴充性又有 redundancy 的基礎架構，一起輕鬆 staking！

## 感謝
謝謝以太坊基金會以 [Eth2 Staking Community Grants](https://blog.ethereum.org/2021/02/09/esp-staking-community-grantee-announcement/) 支持這個專案，能夠對 staker community 貢獻是我們的榮幸！


## 使用工具

這份教學將示範如何在一個 Kubernetes 叢集上維運一個以太坊 2.0 beacon 用戶端和多個 validator 用戶端， 以下是我們使用的工具：

- [Prysm](https://github.com/prysmaticlabs/prysm) 以太坊 2.0 用戶端
- [MicroK8s](https://microk8s.io/) 輕量的 Kubernertes 發行版（[安裝教學](https://microk8s.io/docs)）.
- [Helm 3](https://helm.sh/) Kubernetes 套件管理工具
- [kubectl](https://kubernetes.io/docs/reference/kubectl/overview/) Kubernetes CLI 工具
- Ubuntu Server 20.04.2 LTS (x64) （[下載連結](https://ubuntu.com/download/server)）
- [Network File System (NFS)](https://en.wikipedia.org/wiki/Network_File_System) 作為 beacon 與 validator 的持久性儲存系統（[Ubuntu 文件與教學](https://ubuntu.com/server/docs/service-nfs)）
- [eth2xk8s](https://github.com/lumostone/eth2xk8s) Helm Chart.

## 本文目標

這份教學包含以下內容：

- 使用 MicroK8s 建立一個 Kubernetes 叢集。如果你有已建好的 Kubernetes 叢集，或想使用其他的  Kubernetes 發行版，可以在建好叢集後跳至「[安裝和設定NFS](#安裝和設定-nfs)」章節。如果你是使用雲端服務提供商所提供的 Kubernetes 托管服務（例如 AKS, EKS, GKE 等），你可以考慮直接使用雲端存儲服務（例如 Azure Disk, AWS S3 等）作為 beacon 與 validator 的持久性儲存系統，而非使用 NFS。我們未來會撰寫其他文章討論這個部分。
- 安裝和設定 NFS。
- 準備用以安裝 validator 的 Helm Chart。
- 使用 Helm Chart 安裝 Prysm 開發的 beacon 和 validator 用戶端。
- 確認用戶端狀態。
- 使用 Helm Chart 升級和回溯 Prysm beacon 和 validator 用戶端。

## 非本文目標

這份教學**不包含**：

- 如何調校系統或軟體表現及資源用量。
- 如何存入 validator 押金並產生 validator 金鑰。
- 如何設定高可用性的 Kubernetes 叢集。
- 如何強化 Kubernetes 叢集安全性。

## 免責聲明

這份教學的設置目前僅在以太坊測試網路上開發和測試。 

做質押挖礦（staking）的礦工要承擔相應的風險，我們強烈建議，在正式網路（mainnet） staking 前，都先在測試網路上試跑，藉此熟悉所有可能的維運操作，並透過系統在測試網路上的表現調整硬體配備，強化系統安全。這份教學僅作為使用 Kubernetes 作 staking 的設置參考，**對於因遵循本指南而造成的任何財務損失，作者概不負責。**

## 系統需求

我們需要至少三台機器（虛擬機或實體機皆可）來完成這份教學的設置。一台機器會作為 NFS 伺服器來儲存 staking 資料；第二台機器作為 Kubernetes 叢集裡的「主要」（master）節點，用來運行 Kubernetes 的核心元件；第三台機器則是 Kubernetes 叢集裡的 「工作」（worker）節點用以執行 beacon 及 validator 用戶端。若要作高可用性配置，請參考 [MicroK8s 高可用性設定文件](https://microk8s.io/docs/high-availability)來新增更多的節點，並定期備份 beacon 資料，這樣在資料毀損重建時，也可以較快完成同步再次上線。我們將會在往後的文章裡討論高可用性的設置。 

基於在 [**Pyrmont 測試網路**](https://pyrmont.beaconcha.in/)上的試跑結果以及 [MicroK8s 官方文件](https://microk8s.io/docs)，以下是我們建議的最小系統需求。請注意，**最小系統需求並不保證最佳的系統表現及成本效益。**

Master 主要節點： 

- RAM: 至少 8 GB
- CPU: 至少 1 core 
- Disk: 至少 20 GB 

Worker 工作節點：

- RAM: 至少 8 GB
- CPU: 至少 1 core 
- Disk: 至少 20 GB 

NFS：

- RAM: 至少 2 GB
- CPU: 至少 1 core
- Disk: 至少 250 GB（再次提醒，這個規格是基於測試網路的用量，如果在正式網路執行，可能需準備更多的儲存空間。）

## 網路需求

- 所有機器皆有網際網路連線能力（至少在安裝過程中）。
- 主要節點和工作節點網路可以互通。我們在後續的章節會設定 MicroK8s 所需要的防火牆規則，更多細節可參考 [MicroK8s 官方文件](https://microk8s.io/docs/ports)。
- 主要節點和工作節點皆可連至 NFS 伺服器。
- 主要節點和工作節點皆可連至為質押挖礦所準備的以太坊 1.0 “Goerli” 節點（請參考「[事前準備](#事前準備)」章節)。

## 事前準備

- 已為 validator 存入足夠的押金，並已產生validator 金鑰。如果需要參考步驟，我們推薦 [Somer Esat 的教學文章](https://someresat.medium.com/guide-to-staking-on-ethereum-2-0-ubuntu-pyrmont-prysm-a10b5129c7e3)。
- 已擁有一個以太坊 1.0 測試網路 Goerli 的節點：[Somer Esat 的教學文章](https://someresat.medium.com/guide-to-staking-on-ethereum-2-0-ubuntu-pyrmont-prysm-a10b5129c7e3)也包含了如何架設以太坊 1.0 的測試網路節點，你也可以選擇使用第三方的服務如 [Infura](https://infura.io/) 或 [Alchemy](https://alchemyapi.io/)。
- 規劃好內網，設定好防火牆跟轉發通訊埠。在「[設定步驟](#設定步驟)」章節會提到我們使用的網路設定。
- 已在三台機器安裝 Ubuntu Server 20.04.2 LTS (x64) ，並已指派靜態 IP 位址。

## 設定步驟

### 概要

在這篇教學裡，我們會建立一個 NFS 伺服器，一個 Kubernetes 叢集，並在叢集上安裝以太坊 2.0 beacon 節點及 validator 用戶端。我們將所有的機器放在同一個內網，並指派靜態 IP 位址給每一個機器，以下是我們的網路設定：

**私有內網網段: 172.20.0.0/20 (172.20.0.1 - 172.20.15.254)**
- NFS IP: 172.20.10.10
- 主要節點 IP: 172.20.10.11
- 工作節點 IP: 172.20.10.12
- DNS: 8.8.8.8, 8.8.4.4 (Google’s DNS)

### 安裝系統更新

請在每一台機器上執行以下命令：

```bash
sudo apt update && sudo apt upgrade
sudo apt dist-upgrade && sudo apt autoremove
sudo reboot
```

### 同步系統時間

請在每一台機器上執行以下命令：

1. 設定時區，在此以`America/Los_Angeles`為例：

    ```bash
    timedatectl list-timezones
    sudo timedatectl set-timezone America/Los_Angeles
    ```

2. 確認預設的 timekeeping service (NTP service) 有啟動 

    ```bash
    timedatectl
    ```

3. 安裝`chrony`

    ```bash
    sudo apt install chrony
    ```

4. 編輯`chrony`設定

    ```bash
    sudo nano /etc/chrony/chrony.conf
    ```

    加入以下服務器池：

    ```bash
    pool time.google.com     iburst minpoll 1 maxpoll 2 maxsources 3
    pool us.pool.ntp.org     iburst minpoll 1 maxpoll 2 maxsources 3
    pool ntp.ubuntu.com      iburst minpoll 1 maxpoll 2 maxsources 3
    ```

    更改這兩個設定：

    ```bash
    maxupdateskew 5.0 # The threshold for determining whether an estimate is too unreliable to be used.
    makestep 0.1 -1  # This would step the system clock if the adjustment is larger than 0.1 seconds.
    ```

5. 重新啟動`chrony`服務

    ```bash
    sudo systemctl restart chronyd
    ```

6. 確認`chrony`使用的同步資料來源

    ```bash
    chronyc sources
    ```

    確認`chrony`的狀態

    ```bash
    chronyc tracking
    ```

### 設定防火牆

請在所有機器上執行步驟一至步驟三：

1. 設定預設防火牆規則

    ```bash
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    ```

2. （**建議**）將`ssh`通訊埠從`22`換成其他通訊埠號以強化安全性。透過編輯`sshd_config`設定檔，將`Port 22`改成其他通訊埠號：

    ```bash
    sudo nano /etc/ssh/sshd_config
    ```

    重新啟動`ssh`服務

    ```bash
    sudo service sshd restart
    ```

3. 允許 TCP 連線透過`ssh`所使用的通訊埠進入

    ```bash
    sudo ufw allow <ssh-port>/tcp
    ```

4. 在 NFS 伺服器上加入 NFS 服務所需的防火牆規則：

    ```bash
    sudo ufw allow 2049/tcp
    ```

5. 在主要節點與工作節點的機器上，加入 MicroK8s 所需的防火牆規則：

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

6. 在主要節點與工作節點的機器上，加入 beacon 節點所需的防火牆規則：

    ```bash
    sudo ufw allow 12000/udp
    sudo ufw allow 13000/tcp
    ```

7. 最後，在每一台機器上啟動防火牆服務

    ```bash
    sudo ufw enable
    sudo ufw status numbered
    ```

### 安裝 MicroK8s

你可以直接參考 [MicroK8s 官方文件](https://microk8s.io/docs)，或參考以下步驟來完成安裝與設定。

請在主要節點及工作節點上執行以下命令：

1. 安裝並執行 MicroK8s

    ```bash
    sudo snap install microk8s --classic --channel=1.20/stable
    ```

2. 授予非管理員使用者（non-root user）管理 MicroK8s 的權限。
將該使用者加入 MicroK8s 的群組中，並改變`~/.kube` 目錄的所有權：

    ```bash
    sudo usermod -a -G microk8s $USER
    sudo chown -f -R $USER ~/.kube

    su - $USER # 重新進入該使用者的session來讓改變生效
    ```

3. 等待 MicroK8s 就緒

    ```bash
    microk8s status --wait-ready
    ```

4. 確認所有的節點已就緒

    ```bash
    microk8s kubectl get node
    ```

    在輸出的節點清單上，你應只會看到一個節點。

### 建立叢集

在建立叢集前，請確認 MicroK8s 已成功在主要節點及工作節點上執行。

在主要節點上執行以下步驟：

1. 啟動 DNS 和 Helm 3 功能

    ```bash
    microk8s enable dns helm3
    ```

2. 使用`add-node`命令產生連接字串，用以讓工作節點加入叢集

    ```bash
    microk8s add-node
    ```

    你會看到類似以下輸出結果：

    ```bash
    Join node with:
    microk8s join 172.31.20.243:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf

    If the node you are adding is not reachable through the default
    interface you can use one of the following:

    microk8s join 172.31.20.243:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf
    microk8s join 10.1.84.0:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf
    ```

轉換到工作節點，執行以下步驟：

1. 執行剛剛在主要節點產生的`join`命令，例如：

    ```bash
    microk8s join 172.31.20.243:25000/DDOkUupkmaBezNnMheTBqFYHLWINGDbf
    ```

2. 工作節點成功加入叢集後，請執行以下命令確認兩個節點已準備就緒

    ```bash
    microk8s kubectl get node
    ```

### 安裝和設定 NFS

你可以直接參考 [Ubuntu 官方文件](https://ubuntu.com/server/docs/service-nfs)，或參考以下步驟來完成安裝與設定：

在預計執行 NFS 的機器上：

1. 安裝並啟動 NFS 伺服器

    ```bash
    sudo apt install nfs-kernel-server
    sudo systemctl start nfs-kernel-server.service
    ```

2. 為 beacon 及 validator 錢包建立資料目錄

    ```bash
    sudo mkdir -p /data/prysm/beacon

    sudo mkdir -p /data/prysm/validator-1 /data/prysm/wallet-1
    sudo mkdir -p /data/prysm/validator-2 /data/prysm/wallet-2
    ```

    **請注意每一個錢包只能讓一個 validator 用戶端使用。**你可以匯入多個 validator 金鑰到同一個錢包，並讓一個 validator 用戶端來為多個 validators 提交區塊驗證結果。
    
    **為避免 slashing，請不要讓多個 validator 用戶端使用同一個錢包，或將同一把 validator 金鑰匯入多個有 validator 使用的錢包。**

3. 設定並匯出 NFS 儲存空間

    ```bash
    sudo nano /etc/exports
    ```

    加入以下的設定並存檔：

    ```bash
    /data *(rw,sync,no_subtree_check)
    ```

    設定選項敘述：

    - **\***: hostname 格式 
    - **rw**: 讀寫權限
    - **sync**: 在回覆更動要求前，所有的改變都保證會被寫入儲存空間
    - **no_subtree_check**: 如果設定中包含 no_subtree_check 這個值，之後將不會檢查 subtree。雖然這個設定可能帶來一些安全疑慮，但在某些狀況下，穩定性會因此提升。因為 subtree_checking 比起 no_subtree_check 會造成更多問題，在 nfs-utils 版本 1.1.0 及往後版本，預設值都是 no_subtree_check。

    可以參照 [NFS 伺服器匯出表手冊](https://man7.org/linux/man-pages/man5/exports.5.html)了解其他細節。

    匯出設定

    ```bash
    sudo exportfs -a
    ```


4. 在主要節點及工作節點上安裝`nfs-common`以支援 NFS：

    ```bash
    sudo apt install nfs-common
    ```

### 準備 Validator 錢包

你可以直接參考 [Prysm 官方文件](https://docs.prylabs.network/docs/mainnet/joining-eth2/#step-4-import-your-validator-accounts-into-prysm)，或參考以下步驟來完成錢包設定：

在設定錢包前，請先確認 validator 金鑰已經傳到 NFS 伺服器上。這一個章節我們要來用上一章裡建好的錢包目錄來建立錢包並匯入 validator 金鑰。

我們使用 Prysm 提供的腳本來完成設定：
1. 請參考 [Prysm 官方文件](https://docs.prylabs.network/docs/install/install-with-script/#downloading-the-prysm-startup-script)下載設定腳本（Prysm startup script）

2. 執行腳本時要提供金鑰所在的目錄路徑到`--keys-dir=<path/to/validator-keys>`參數。我們的範例裡使用`$HOME/eth2.0-deposit-cli/validator_keys`當作金鑰目錄

    ```bash
    sudo ./prysm.sh validator accounts import --keys-dir=$HOME/eth2.0-deposit-cli/validator_keys
    ```

3. 接著輸入錢包目錄路徑，例如`/data/prysm/wallet-1`

4. 輸入錢包密碼（**記得備份在一個安全的地方！**)

5. 接著輸入 validator 金鑰的密碼（使用 [eth2.0-deposit-cli](https://github.com/ethereum/eth2.0-deposit-cli) 產生 validator 金鑰時所建立的那組密碼）。如果輸入正確，即可成功匯入 validator 帳號至錢包裡。

### 改變資料目錄擁有者

為了讓 Kubernetes 能夠替 beacon 及 validator 正確地掛載儲存空間，我們必須改變 NFS 上的資料目錄 owner：

```bash
sudo chown -R 1001:2000 /data # you can pick other user ID and group ID
```

### 準備 Helm Chart

我們知道要從零開始學習 Kubernetes 以及寫出建立資源的 YAML 文件不是一件簡單的事，所以我們開發了可用來建立 beacon 和 validator 用戶端的 YAML 檔和 Helm Chart，並上傳到 [eth2xk8s](https://github.com/lumostone/eth2xk8s) Github repository 來供大家使用。希望能幫助大家更容易上手！

在這篇教學裡，我們用 Helm 來安裝與升級 beacon 及 validator 用戶端。你也可以不使用 Helm 直接使用 YAML 檔來建立 Kubernetes 資源。細節可以看這兩篇文章：「[使用 Kubernetes manifests 以及 hostPath 測試以太坊 2.0 Staking](https://github.com/lumostone/eth2xk8s/blob/master/host-path/README.md) 」以及「[使用 Kubernetes manifests 以及 NFS 測試以太坊 2.0 Staking](https://github.com/lumostone/eth2xk8s/blob/master/nfs/README.md)」。

1. Clone [eth2xk8s](https://github.com/lumostone/eth2xk8s) Github 專案

    ```bash
    git clone https://github.com/lumostone/eth2xk8s.git
    ```

2. 更改 [./eth2prysm/values.yaml](https://github.com/lumostone/eth2xk8s/blob/master/eth2prysm/values.yaml) 的值

    建議閱讀`values.yaml`的每個變數及說明，確認是否更改預設值。以下列出安裝 Helm Chart 前必須更改的變數：
    - **nfs.serverIp**: NFS 伺服器 IP 地址
    - **nfs.user**: 容器（container）裡的每個程序（process）會使用這個 user ID 來執行。這個使用者需擁有存取掛載的 NFS 資料目錄路徑的權限。
    - **nfs.group**: 容器裡的每個程序會使用這個 group ID 來執行。這個群組需擁有存取掛載的 NFS 資料目錄路徑的權限。我們用此來給予程序有限的權限，不然預設 Kubernetes 會使用 root 群組執行程序。
    - **image.version**: Prysm 用戶端版本
    - **beacon.dataVolumePath**: NFS 上的 beacon 資料目錄路徑
    - **beacon.web3Provider** 及 **beacon.fallbackWeb3Providers**: 以太坊 1.0 節點網址
    - **validators.validator1.dataVolumePath**: NFS 上的 validator 資料目錄路徑
    - **validators.validator1.walletVolumePath**: NFS 上的錢包資料目錄路徑
    - **validators.validator1.walletPassword**: 錢包密碼

### 使用 Helm Chart 安裝 Prysm

Kubernetes 使用 [namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) 來作命名及資源區隔及存取限制。我們使用`prysm`當作 Prysm 用戶端的 namespace。

Helm 使用 [releases](https://helm.sh/docs/glossary/#release) 來追蹤 chart 的安裝紀錄。在這篇教學裡，我們用`eth2xk8s`當作我們的 release 名字，你也可以改成其他你想要的名字。

在主要節點上：

1. 創造一個 namespace

    ```bash
    microk8s kubectl create namespace prysm
    ```

2. 安裝 Prysm 用戶端

    ```bash
    microk8s helm3 install eth2xk8s ./eth2prysm -nprysm
    ```

3. 檢查部署設定

    ```bash
    microk8s helm3 get manifest eth2xk8s -nprysm
    ```

### 檢查用戶端狀態

1. 檢查部署狀態

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```

    這個指令會持續監控狀態變化，我們只需等到 beacon 及 validator 用戶端都變成 Running 狀態即可。

2. 檢查 beacon 的執行記錄

    ```bash
    microk8s kubectl logs -f -nprysm -l app=beacon
    ```

3. 檢查 validator 的執行記錄

    ```bash
    microk8s kubectl logs -f -nprysm -l app=validator1
    ```

    如果想檢查其他的 validator，可以將`-l app=<validator name>`更改成在`values.yaml`設定的其他 validator 的名字，以 validator2 為例

    ```bash
    microk8s kubectl logs -f -nprysm -l app=validator2
    ```

### 使用 Helm Chart 更新 Prysm 版本

以太坊 2.0 用戶端的新版本推出速度很快，我們應該盡快更新用戶端版本來獲得最新的 bug fixes 和功能。為了簡化版本跟軟體部署的管理，我們推薦用 Helm 來更新版本：

1. 到 [Prysm Github 版本釋出頁面](https://github.com/prysmaticlabs/prysm/releases)查看最新版本

2. 將`values.yaml`中的 **image.version** 改成最新版本（例如 `v1.3.4`）並儲存`values.yaml`

3. 執行以下 Helm 指令更新用戶端

    ```bash
    microk8s helm3 upgrade eth2xk8s ./eth2prysm -nprysm
    ```

4. 檢查部署設定，確認用戶端已更新成新版本

    ```bash
    microk8s helm3 get manifest eth2xk8s -nprysm
    ```

5. 依照「[檢查用戶端狀態](#檢查用戶端狀態)」章節檢查用戶端是否正常執行

### 使用 Helm 回溯版本

如果版本回溯不牽涉資料庫 schema 變動的話，使用 Helm 回溯版本就跟更新一樣直覺。以下是範例步驟及指令：

1. 使用`helm history`指令找出並記下想要回溯到的版本號碼

    ```bash
    microk8s helm3 history eth2xk8s -nprysm
    ```

2. 回溯到指定版本（以下指令假設我們要回溯到版本 4）

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nprysm
    ```

3. 接著依照「[檢查用戶端狀態](#檢查用戶端狀態)」章節檢查部署設定以及用戶端是否正常執行。

如果版本回溯前需要先還原資料庫 schema，可以參照「[使用 Helm 回溯版本（如果資料庫 Schema 有更動)](#使用-helm-回溯版本如果資料庫-schema-有更動)」章節。

某些情況下有可能沒辦法回溯到之前的版本（[例子](https://docs.prylabs.network/docs/prysm-usage/staying-up-to-date/#downgrading-between-major-version-bumps)），在回溯前記得先確認用戶端相關文件。

## 結論

感謝你的閱讀！我們希望這篇文章能夠幫助想要使用 Kubernetes 來做以太坊 2.0 staking 的你。我們會繼續製作相關教學，之後我們也會開發給其他以太坊 2.0 用戶端的 Helm Chart。敬請期待！

## 有任何建議或是疑問嗎？

請讓我們知道你的想法！如果對這篇文章有任何問題及建議都歡迎到我們[網站的 Github 專案](https://github.com/lumostone/lumostone.github.io)開 issue 或是發 pull request。如果你對於貢獻以太坊 2.0 Staking 的 Helm Chart 有興趣，請將 issue 或 pull request 發至 [eth2xk8s](https://github.com/lumostone/eth2xk8s) 跟我們聯繫。

## 附錄

### 檢查 CPU 及記憶體用量

如果想知道每個 pod 的 CPU 及記憶體用量，可以使用 Github 開源專案 [metrics server](https://github.com/kubernetes-sigs/metrics-server) 來取得資料。

1. 首先，用以下的指令在 Kubernetes 叢集上安裝 metrics server

    ```bash
    microk8s kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    ```

2. 接著可以執行`kubectl top`指令來得到用量資訊，下面兩個例子分別會得到 beacon 及 validator 的用量。

    ```bash
    microk8s kubectl top pod -l app=beacon
    microk8s kubectl top pod -l app=validator
    ```

### 解除安裝 Helm Chart

如果想要停止執行以及移除 Prysm，可以執行以下指令來移除整個 Helm Chart：

```bash
microk8s helm3 uninstall eth2xk8s -nprysm
```

### 使用 Helm 回溯版本（如果資料庫 Schema 有更動）

以 [Prysm v1.3.0 版本](https://github.com/prysmaticlabs/prysm/releases/tag/v1.3.0)為例，如果想要回溯至 v1.2.x，我們需要在回溯前先跑一個腳本來還原 v1.3.0 帶來的資料庫 schema 變動。所以如果我們照著「[使用 Helm 回溯版本](#使用-helm-回溯版本)」的步驟執行指令，在用 Helm 改變 Prsym 版本成 v1.2.2 之後，所有的 pods 會馬上重啟，但 Prysm 可能會因為資料庫 schema 只適用於 v1.3.0 版本而無法正常啟動。

要解決這個問題，我們可以利用 Kubernetes 暫時把 pod 的數量降成 0。在此期間，不會有任何 Prysm 程式能夠執行，我們也就能趁機執行腳本復原新版本帶來的 schema 變動，然後再恢復 pod 的數量，最後再回溯版本。以下是範例步驟及指令：

1. 在還原版本前，用以下指令先把 pod 的數量降成 0

    只調整 beacon：

    ```bash
    microk8s kubectl scale deployments/beacon -nprysm --replicas=0
    ```

    如果 schema 變動只影響 validator 用戶端，我們可以只調整 validator：

    ```bash
    microk8s kubectl scale deployments/validator1 -nprysm --replicas=0
    ```

2. 確認所有 pod 都已停止

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```

3. 執行腳本復原 schema 變動

4. 回溯到版本 4

    ```bash
    microk8s helm3 rollback eth2xk8s 4 -nprysm
    ```

5. 恢復 beacon 及 validator pod 的數量

    ```bash
    microk8s kubectl scale deployments/beacon -nprysm --replicas=1
    microk8s kubectl scale deployments/validator1 -nprysm --replicas=1
    ```

6. 確認所有 pod 都恢復執行

    ```bash
    microk8s kubectl get pod -nprysm -w
    ```
