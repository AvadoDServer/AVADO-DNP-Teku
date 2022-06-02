import axios from "axios";

export class KeyManagerAPI {
    apiKey: string;
    baseUrl: string;

    constructor(baseUrl: string, apiKey: string) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    async get<R>(path: string, callback: (res: any) => R, errorHandler: (e: any) => R) {
        try {
            return await axios.get(`${this.baseUrl}${path}`, {
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${this.apiKey}`
                }
            }).then(res => callback(res));
        } catch (e: any) {
            return errorHandler(e)
        }

    }

    async post(path: string, data: object, callback: (res: any) => void, errorHandler: (e: any) => void) {
        try {
            return await axios.post(`${this.baseUrl}${path}`, data, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                data: data
            }).then(res => callback(res));
        } catch (e: any) {
            errorHandler(e)
        }
    }

    async delete(path: string, data: object, callback: (res: any) => void, errorHandler: (e: any) => void) {
        try {
            return await axios.delete(`${this.baseUrl}${path}`, {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`
                }
            }).then(res => callback(res));
        } catch (e: any) {
            errorHandler(e)
        }
    }
}