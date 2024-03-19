import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faBook } from "@fortawesome/free-solid-svg-icons";
import { RestApi } from "./RestApi";
import { Network } from "./Types";
interface Props {
    api: RestApi | null | undefined
    prefix: string,
    title: string,
    network: Network,
    refreshinterval?: number,
}

interface SyncData {
    head_slot: string
    sync_distance: string
    is_syncing: boolean
    is_optimistic: boolean
}

interface Peer {
    direction: "inbound" | "outbound"
    state: "disconnected" | "connecting" | "connected" | "disconnecting"
}

enum Health { ready, syncing, not_ready }

const Comp = ({ api, prefix, title, network, refreshinterval = 30 }: Props) => {
    const [syncData, setSyncData] = React.useState<SyncData | null>(null);
    const [error, setError] = React.useState<String | null>(null);
    const [peerCount, setPeerCount] = React.useState<number>(0);
    const [peers, setPeers] = React.useState<[Peer]>();
    const [version, setVersion] = React.useState<String | null>(null);
    const [health, setHealth] = React.useState<Health>(Health.not_ready);

    React.useEffect(() => {
        const updateHealth = async () => {
            if (!api)
                return;
            api.get(`/${prefix}/eth/v1/node/health`, res => {
                if (res.status === 200) {
                    setHealth(Health.ready)
                } else if (res.status === 206) {
                    setHealth(Health.syncing)
                } else {
                    setHealth(Health.not_ready)
                }
            }, (e) => {
                setHealth(Health.not_ready)
            });
        }

        updateHealth();
        const interval = setInterval(() => {
            updateHealth();
        }, refreshinterval * 1000); // 5 seconds refresh
        return () => clearInterval(interval);
    }, [api]);

    React.useEffect(() => {
        const callAPI = (path: string, setter: (res: any) => void) => {
            api?.get(path, res => {
                setter(res)
            }, (e) => {
                //ignore
            });
        }

        const updateStats = () => {
            // console.log("health:", Health[health])
            if (health !== Health.not_ready && api) {
                callAPI(`/${prefix}/eth/v1/node/syncing`, res => { if (res.status === 200) setSyncData(res.data.data) })
                callAPI(`/${prefix}/eth/v1/node/peer_count`, res => { if (res.status === 200) setPeerCount(res.data.data.connected) })
                callAPI(`/${prefix}/eth/v1/node/peers`, res => { if (res.status === 200) setPeers(res.data.data) })
            }
        }

        const getVersion = () => {
            if (health !== Health.not_ready && api) {
                callAPI(`/${prefix}/eth/v1/node/version`, res => {
                    if (res.status === 200) {
                        const rawversion = res.data.data.version
                        const version = rawversion.replace(/.*\/(v[\d.]+).*/, "$1")
                        setVersion(version);
                    }
                })
            }
        }

        updateStats();
        getVersion();
        const interval = setInterval(() => {
            updateStats();
        }, refreshinterval * 1000); // 5 seconds refresh
        return () => clearInterval(interval);
    }, [health, api]);

    React.useEffect(() => {
        if (health === Health.not_ready)
            setError("Waiting for beacon chain to become ready");
        else {
            setError(null);
        }
    }, [health]);

    const getSyncPercentage = (syncData: SyncData) => {
        const headSlot = parseFloat(syncData.head_slot)
        const total = headSlot + parseFloat(syncData.sync_distance)
        return (Math.floor(headSlot * 100.0 * 100.0 / total) / 100.0).toFixed(2) + "%" // round down to two decimal places
    }

    const slots_per_epoch = network === "gnosis" ? 16 : 32

    return (<>
        <p className="has-text-right">
            {error
                ? (
                    <span className="tag is-danger">{error}<FontAwesomeIcon className="fa-spin" icon={faSpinner} /></span>
                ) : (syncData && peerCount &&
                    <><h4 className="is-size-5">{title}</h4>
                        status: {(syncData.is_syncing === false && (peerCount > 0)
                        ) ? (<span className="tag is-success">in sync</span>
                        ) : (<><span className="tag is-warning">syncing</span></>
                        )}
                        {(version && <><br />version: {version}</>)}
                        <br />
                        connected peers: {peerCount}
                        <br />
                        {(peers &&
                            <> (Inbound: {peers.filter(p => p.direction === "inbound" && p.state === "connected").length}/Outbound: {peers.filter(p => p.direction === "outbound" && p.state === "connected").length})</>
                        )}

                        <br />
                        epoch: {Math.floor(parseFloat(syncData.head_slot) / slots_per_epoch)}, slot {syncData.head_slot}
                    </>
                )}
        </p>

    </>

    );

}


export default Comp;
