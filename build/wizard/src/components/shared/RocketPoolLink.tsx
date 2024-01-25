import React, { useEffect, useState } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { faRocket } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ValidatorData } from "./Validators";
import axios from "axios";
import { Network } from "./Types";
import { RestApi } from "./RestApi";

interface Props {
    api: RestApi | undefined | null,
    validator: ValidatorData,
    network: Network
}

const RocketPoolLink = ({ api, validator, network }: Props) => {

    const [minipool, setMinipool] = useState<string>();

    useEffect(() => {
        const beaconchainUrl = () => {
            switch (network) {
                case "prater": return "prater.beaconcha.in"
                case "holesky": return "holesky.beaconcha.in"
                case "gnosis": return "beacon.gnosischain.com"
                default: return "beaconcha.in"
            }
        }

        if (validator.index !== "pending") {
            const url = api?.baseUrl + `/${beaconchainUrl()}/api/v1/rocketpool/validator/${validator.validator.pubkey}`
            // console.log(url)
            axios.get(url).then((res) => {
                const result = res.data;
                if (result.status === "OK") {
                    setMinipool(result.data.minipool_address)
                }
            }).catch(e => console.log(e))
        }
    }, [validator]);

    const rocketscanUrl = () => {
        switch (network) {
            case "prater": return "https://prater.rocketscan.io"
            case "holesky": return "https://holesky.rocketscan.io"
            case "gnosis": return ""
            default: return "https://rocketscan.io"
        }
    }
    const minipoolAddress = (minipool: string) => `${rocketscanUrl()}/minipool/${minipool}`

    if (!minipool)
        return <></>

    return <a href={minipoolAddress(minipool)}>
        <span className="icon has-text-info">
            <FontAwesomeIcon icon={faRocket} />
        </span>
    </a>
};

export default RocketPoolLink
