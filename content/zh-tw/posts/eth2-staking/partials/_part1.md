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
- [MicroK8s](https://microk8s.io/) 輕量的 Kubernertes 發行版（[安裝教學](https://microk8s.io/docs)）
- [Helm 3](https://helm.sh/) Kubernetes 套件管理工具
- [kubectl](https://kubernetes.io/docs/reference/kubectl/overview/) Kubernetes CLI 工具
- Ubuntu Server 20.04.2 LTS (x64) （[下載連結](https://ubuntu.com/download/server)）
- [Network File System (NFS)](https://en.wikipedia.org/wiki/Network_File_System) 作為 beacon 與 validator 用戶端的持久性儲存系統（[Ubuntu 文件與教學](https://ubuntu.com/server/docs/service-nfs)）
- [eth2xk8s](https://github.com/lumostone/eth2xk8s) Helm Chart

## 本文目標

這份教學包含以下內容：

- 使用 MicroK8s 建立一個 Kubernetes 叢集。如果你有已建好的 Kubernetes 叢集，或想使用其他的  Kubernetes 發行版，可以在建好叢集後跳至「[安裝和設定NFS](#安裝和設定-nfs)」章節。如果你是使用雲端服務提供商所提供的 Kubernetes 托管服務（例如 AKS, EKS, GKE 等），你可以考慮直接使用雲端存儲服務（例如 Azure Disk, AWS S3 等）作為 beacon 與 validator 用戶端的持久性儲存系統，而非使用 NFS。我們未來會撰寫其他文章討論這個部分。
- 安裝和設定 NFS。
- 準備用以安裝 Prysm 以太坊 2.0 用戶端的 Helm Chart。
- 使用 Helm Chart 安裝 Prysm 以太坊 2.0 用戶端。
- 確認用戶端狀態。
- 使用 Helm Chart 升級和回溯 Prysm 以太坊 2.0 用戶端。

## 非本文目標

這份教學**不包含**：

- 如何調校系統或軟體表現及資源用量。
- 如何存入 validator 押金並產生 validator 金鑰。
- 如何設定高可用性的 Kubernetes 叢集。
- 如何強化 Kubernetes 叢集安全性。

## 免責聲明

這份教學的設置目前僅在以太坊測試網路上開發和測試。 

做質押挖礦（staking）的礦工要承擔相應的風險，我們強烈建議，在正式網路（mainnet）staking 前，都先在測試網路上試跑，藉此熟悉所有可能的維運操作，並透過系統在測試網路上的表現調整硬體配備，強化系統安全。這份教學僅作為使用 Kubernetes 作 staking 的設置參考，**對於因遵循本指南而造成的任何財務損失，作者概不負責。**

## 系統需求

我們需要至少三台機器（虛擬機或實體機皆可）來完成這份教學的設置。一台機器會作為 NFS 伺服器來儲存 staking 資料；第二台機器作為 Kubernetes 叢集裡的「主要」（master）節點，用來運行 Kubernetes 的核心元件；第三台機器則是 Kubernetes 叢集裡的 「工作」（worker）節點用以執行 beacon 及 validator 用戶端。若要作高可用性配置，請參考 [MicroK8s 高可用性設定文件](https://microk8s.io/docs/high-availability)來新增更多的節點，並定期備份 beacon 資料，這樣在資料毀損重建時，也可以較快完成同步再次上線。我們將會在往後的文章裡討論高可用性的設置。 

基於在 [**Prater 測試網路**](https://prater.beaconcha.in/)上的試跑結果以及 [MicroK8s 官方文件](https://microk8s.io/docs)，以下是我們建議的最小系統需求。請注意，**最小系統需求並不保證最佳的系統表現及成本效益。**

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
- 主要節點和工作節點皆可連至為質押挖礦所準備的以太坊 1.0 “Goerli” 節點（請參考「[事前準備](#事前準備)」章節）。

## 事前準備

- 已為 validator 存入足夠的押金，並已產生 validator 金鑰。如果需要參考步驟，我們推薦 [Somer Esat 的教學文章](https://someresat.medium.com/guide-to-staking-on-ethereum-2-0-ubuntu-pyrmont-prysm-a10b5129c7e3)。
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

2. 授予非管理員使用者（non-root user）管理 MicroK8s 的權限。將該使用者加入 MicroK8s 的群組中，並改變`~/.kube` 目錄的所有權：

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
