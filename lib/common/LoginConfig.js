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
exports.LoginConfig = void 0;
const core = __importStar(require("@actions/core"));
const actions_secret_parser_1 = require("actions-secret-parser");
class LoginConfig {
    constructor() {
        this.enableOIDC = true;
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            this.environment = core.getInput("environment").toLowerCase();
            this.enableAzPSSession = core.getInput('enable-AzPSSession').toLowerCase() === "true";
            this.allowNoSubscriptionsLogin = core.getInput('allow-no-subscriptions').toLowerCase() === "true";
            this.servicePrincipalId = core.getInput('client-id', { required: false });
            this.servicePrincipalKey = null;
            this.tenantId = core.getInput('tenant-id', { required: false });
            this.subscriptionId = core.getInput('subscription-id', { required: false });
            this.audience = core.getInput('audience', { required: false });
            this.federatedToken = null;
            let creds = core.getInput('creds', { required: false });
            let secrets = creds ? new actions_secret_parser_1.SecretParser(creds, actions_secret_parser_1.FormatType.JSON) : null;
            if (creds) {
                core.debug('using creds JSON...');
                this.enableOIDC = false;
                this.servicePrincipalId = secrets.getSecret("$.clientId", true);
                this.servicePrincipalKey = secrets.getSecret("$.clientSecret", true);
                this.tenantId = secrets.getSecret("$.tenantId", true);
                this.subscriptionId = secrets.getSecret("$.subscriptionId", true);
                this.resourceManagerEndpointUrl = secrets.getSecret("$.resourceManagerEndpointUrl", false);
            }
            this.getFederatedTokenIfNecessary();
        });
    }
    getFederatedTokenIfNecessary() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.enableOIDC) {
                return;
            }
            try {
                this.federatedToken = yield core.getIDToken(this.audience);
            }
            catch (error) {
                core.error(`Please make sure to give write permissions to id-token in the workflow.`);
                throw error;
            }
            if (!!this.federatedToken) {
                let [issuer, subjectClaim] = yield jwtParser(this.federatedToken);
                console.log("Federated token details: \n issuer - " + issuer + " \n subject claim - " + subjectClaim);
            }
            else {
                throw new Error("Failed to fetch federated token.");
            }
        });
    }
    validate() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.servicePrincipalId || !this.tenantId || !(this.servicePrincipalKey || this.enableOIDC)) {
                throw new Error("Not all values are present in the credentials. Ensure clientId, clientSecret and tenantId are supplied.");
            }
            if (!this.subscriptionId && !this.allowNoSubscriptionsLogin) {
                throw new Error("Not all values are present in the credentials. Ensure subscriptionId is supplied.");
            }
            if (!LoginConfig.azureSupportedCloudName.has(this.environment)) {
                throw new Error("Unsupported value for environment is passed.The list of supported values for environment are ‘azureusgovernment', ‘azurechinacloud’, ‘azuregermancloud’, ‘azurecloud’ or ’azurestack’");
            }
        });
    }
}
exports.LoginConfig = LoginConfig;
LoginConfig.azureSupportedCloudName = new Set([
    "azureusgovernment",
    "azurechinacloud",
    "azuregermancloud",
    "azurecloud",
    "azurestack"
]);
function jwtParser(federatedToken) {
    return __awaiter(this, void 0, void 0, function* () {
        let tokenPayload = federatedToken.split('.')[1];
        let bufferObj = Buffer.from(tokenPayload, "base64");
        let decodedPayload = JSON.parse(bufferObj.toString("utf8"));
        return [decodedPayload['iss'], decodedPayload['sub']];
    });
}
