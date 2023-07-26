"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureCliLogin = void 0;
const exec = __importStar(require("@actions/exec"));
const core = __importStar(require("@actions/core"));
const io = __importStar(require("@actions/io"));
class AzureCliLogin {
    constructor(loginConfig) {
        this.loginConfig = loginConfig;
    }
    login() {
        return __awaiter(this, void 0, void 0, function* () {
            this.azPath = yield io.which("az", true);
            core.debug(`az cli path: ${this.azPath}`);
            let output = "";
            const execOptions = {
                listeners: {
                    stdout: (data) => {
                        output += data.toString();
                    }
                }
            };
            yield this.executeAzCliCommand("--version", true, execOptions);
            core.debug(`az cli version used:\n${output}`);
            this.setAzurestackEnvIfNecessary();
            yield this.executeAzCliCommand(`cloud set -n "${this.loginConfig.environment}"`, false);
            console.log(`Done setting cloud: "${this.loginConfig.environment}"`);
            // Attempting Az cli login
            var commonArgs = ["--service-principal",
                "-u", this.loginConfig.servicePrincipalId,
                "--tenant", this.loginConfig.tenantId
            ];
            if (this.loginConfig.allowNoSubscriptionsLogin) {
                commonArgs = commonArgs.concat("--allow-no-subscriptions");
            }
            if (this.loginConfig.enableOIDC) {
                commonArgs = commonArgs.concat("--federated-token", this.loginConfig.federatedToken);
            }
            else {
                console.log("Note: Azure/login action also supports OIDC login mechanism. Refer https://github.com/azure/login#configure-a-service-principal-with-a-federated-credential-to-use-oidc-based-authentication for more details.");
                commonArgs = commonArgs.concat(`--password=${this.loginConfig.servicePrincipalKey}`);
            }
            const loginOptions = defaultExecOptions();
            yield this.executeAzCliCommand(`login`, true, loginOptions, commonArgs);
            if (!this.loginConfig.allowNoSubscriptionsLogin) {
                var args = [
                    "--subscription",
                    this.loginConfig.subscriptionId
                ];
                yield this.executeAzCliCommand(`account set`, true, loginOptions, args);
            }
        });
    }
    setAzurestackEnvIfNecessary() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.loginConfig.environment != "azurestack") {
                return;
            }
            if (!this.loginConfig.resourceManagerEndpointUrl) {
                throw new Error("resourceManagerEndpointUrl is a required parameter when environment is defined.");
            }
            console.log(`Unregistering cloud: "${this.loginConfig.environment}" first if it exists`);
            try {
                yield this.executeAzCliCommand(`cloud set -n AzureCloud`, true);
                yield this.executeAzCliCommand(`cloud unregister -n "${this.loginConfig.environment}"`, false);
            }
            catch (error) {
                console.log(`Ignore cloud not registered error: "${error}"`);
            }
            console.log(`Registering cloud: "${this.loginConfig.environment}" with ARM endpoint: "${this.loginConfig.resourceManagerEndpointUrl}"`);
            try {
                let baseUri = this.loginConfig.resourceManagerEndpointUrl;
                if (baseUri.endsWith('/')) {
                    baseUri = baseUri.substring(0, baseUri.length - 1); // need to remove trailing / from resourceManagerEndpointUrl to correctly derive suffixes below
                }
                let suffixKeyvault = ".vault" + baseUri.substring(baseUri.indexOf('.')); // keyvault suffix starts with .
                let suffixStorage = baseUri.substring(baseUri.indexOf('.') + 1); // storage suffix starts without .
                let profileVersion = "2019-03-01-hybrid";
                yield this.executeAzCliCommand(`cloud register -n "${this.loginConfig.environment}" --endpoint-resource-manager "${this.loginConfig.resourceManagerEndpointUrl}" --suffix-keyvault-dns "${suffixKeyvault}" --suffix-storage-endpoint "${suffixStorage}" --profile "${profileVersion}"`, false);
            }
            catch (error) {
                core.error(`Error while trying to register cloud "${this.loginConfig.environment}": "${error}"`);
            }
            console.log(`Done registering cloud: "${this.loginConfig.environment}"`);
        });
    }
    executeAzCliCommand(command, silent, execOptions = {}, args = []) {
        return __awaiter(this, void 0, void 0, function* () {
            execOptions.silent = !!silent;
            yield exec.exec(`"${this.azPath}" ${command}`, args, execOptions);
        });
    }
}
exports.AzureCliLogin = AzureCliLogin;
function defaultExecOptions() {
    return {
        silent: true,
        listeners: {
            stderr: (data) => {
                let error = data.toString();
                let startsWithWarning = error.toLowerCase().startsWith('warning');
                let startsWithError = error.toLowerCase().startsWith('error');
                // printing ERROR
                if (error && error.trim().length !== 0 && !startsWithWarning) {
                    if (startsWithError) {
                        //removing the keyword 'ERROR' to avoid duplicates while throwing error
                        error = error.slice(5);
                    }
                    core.setFailed(error);
                }
            }
        }
    };
}
