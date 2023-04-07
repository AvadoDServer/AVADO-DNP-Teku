import React, { useEffect, useState } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { faRocket } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ValidatorData } from "./Validators";
import axios from "axios";

interface Props {
    validator: ValidatorData
}

const RocketPoolLink = ({ validator }: Props) => {

    const [minipool, setMinipool] = useState<string>();

    useEffect(() => {
        axios.get(`https://prater.beaconcha.in/api/v1/rocketpool/validator/${validator.validator.pubkey}`).then((res) => {
            const result = res.data;
            if (result.status === "OK") {
                setMinipool(result.data.minipool_address)
            }
        })
    }, [validator]);

    const minipoolAddress = (minipool: string) => `https://prater.rocketscan.io/minipool/${minipool}`

    if (!minipool)
        return <></>

    return <a href={minipoolAddress(minipool)}>
        <span className="icon has-text-info">
            <FontAwesomeIcon icon={faRocket} />
        </span>
    </a>
};

export default RocketPoolLink
