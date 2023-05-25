import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { ExecOptions } from '@actions/exec/lib/interfaces';
import * as io from '@actions/io';
import { FormatType, SecretParser } from 'actions-secret-parser';
import { ServicePrincipalLogin } from './PowerShell/ServicePrincipalLogin';

var azPath: string;
var prefix = !!process.env.AZURE_HTTP_USER_AGENT ? `${process.env.AZURE_HTTP_USER_AGENT}` : "";
var azPSHostEnv = !!process.env.AZUREPS_HOST_ENVIRONMENT ? `${process.env.AZUREPS_HOST_ENVIRONMENT}` : "";

async function main() {
    try {
        //Options for error handling
        const loginOptions: ExecOptions = {
            silent: true,
            listeners: {
                stderr: (data: Buffer) => {
                    let error = data.toString();
                    let startsWithWarning = error.toLowerCase().startsWith('warning');
                    let startsWithError = error.toLowerCase().startsWith('error');
                    // printing ERROR
                    if (error && error.trim().length !== 0 && !startsWithWarning) {
                        if(startsWithError) {
                            //removing the keyword 'ERROR' to avoid duplicates while throwing error
                            error = error.slice(5);
                        }
                        core.setFailed(error);
                    }
                }
            }
        }
        // Set user agent variable
        var isAzCLISuccess = false;
        let usrAgentRepo = `${process.env.GITHUB_REPOSITORY}`;
        let actionName = 'AzureLogin';
        let userAgentString = (!!prefix ? `${prefix}+` : '') + `GITHUBACTIONS/${actionName}@v1_${usrAgentRepo}`;
        let azurePSHostEnv = (!!azPSHostEnv ? `${azPSHostEnv}+` : '') + `GITHUBACTIONS/${actionName}@v1_${usrAgentRepo}`;
        core.exportVariable('AZURE_HTTP_USER_AGENT', userAgentString);
        core.exportVariable('AZUREPS_HOST_ENVIRONMENT', azurePSHostEnv);

        azPath = await io.which("az", true);
        core.debug(`az cli path: ${azPath}`);
        let azureSupportedCloudName = new Set([
            "azureusgovernment",
            "azurechinacloud",
            "azuregermancloud",
            "azurecloud",
            "azurestack"]);

        let output: string = "";
        const execOptions: any = {
            listeners: {
                stdout: (data: Buffer) => {
                    output += data.toString();
                }
            }
        };
        await executeAzCliCommand("--version", true, execOptions);
        core.debug(`az cli version used:\n${output}`);

        let creds = core.getInput('creds', { required: false });
        let secrets = creds ? new SecretParser(creds, FormatType.JSON) : null;
        let environment = core.getInput("environment").toLowerCase();
        const enableAzPSSession = core.getInput('enable-AzPSSession').toLowerCase() === "true";
        const allowNoSubscriptionsLogin = core.getInput('allow-no-subscriptions').toLowerCase() === "true";

        //Input the credentials in individual parameters in the workflow
        var servicePrincipalId = core.getInput('client-id', { required: false });
        var servicePrincipalKey = null;
        var tenantId = core.getInput('tenant-id', { required: false });
        var subscriptionId = core.getInput('subscription-id', { required: false });
        var resourceManagerEndpointUrl = "https://management.azure.com/";
        var enableOIDC = true;
        var federatedToken = null;

        //Use creds as supplementary to individual parameters
        if (creds) {
            core.debug('using creds JSON...');
            servicePrincipalId = servicePrincipalId ? servicePrincipalId : secrets.getSecret("$.clientId", false);
            servicePrincipalKey = secrets.getSecret("$.clientSecret", false);
            tenantId = tenantId ? tenantId : secrets.getSecret("$.tenantId", false);
            subscriptionId = subscriptionId ? subscriptionId : secrets.getSecret("$.subscriptionId", false);
            resourceManagerEndpointUrl = secrets.getSecret("$.resourceManagerEndpointUrl", false);
        }

        //If clientSecret is passed, use non-OIDC login by default
        if (servicePrincipalKey) {
            enableOIDC = false;
        }

        // Generate ID-token for OIDC
        if (enableOIDC) {
            console.log('Using OIDC authentication...')
            let audience = core.getInput('audience', { required: false });
            try{
                federatedToken = await core.getIDToken(audience);
            }
            catch (error) {
                core.error(`Please make sure to give write permissions to id-token in the workflow.`);
                throw error;
            }
            if (!!federatedToken) {
                let [issuer, subjectClaim] = await jwtParser(federatedToken);
                console.log("Federated token details: \n issuer - " + issuer + " \n subject claim - " + subjectClaim);
            }
            else{
                throw new Error("Failed to fetch federated token.");
            }
        }

        // Check validity of the input environment
        if (!azureSupportedCloudName.has(environment)) {
            throw new Error(`Unsupported value for environment is passed.The list of supported values for environment
            are ‘azureusgovernment', ‘azurechinacloud’, ‘azuregermancloud’, ‘azurecloud’ or ’azurestack’`);
        }

        // Prepare for Azure Stack
        if (environment == "azurestack") {
            if (!resourceManagerEndpointUrl) {
                throw new Error("resourceManagerEndpointUrl is a required parameter when environment is defined.");
            }

            console.log(`Unregistering cloud: "${environment}" first if it exists`);
            try {
                await executeAzCliCommand(`cloud set -n AzureCloud`, true);
                await executeAzCliCommand(`cloud unregister -n "${environment}"`, false);
            }
            catch (error) {
                console.log(`Ignore cloud not registered error: "${error}"`);
            }

            console.log(`Registering cloud: "${environment}" with ARM endpoint: "${resourceManagerEndpointUrl}"`);
            try {
                let baseUri = resourceManagerEndpointUrl;
                if (baseUri.endsWith('/')) {
                    baseUri = baseUri.substring(0, baseUri.length - 1); // need to remove trailing / from resourceManagerEndpointUrl to correctly derive suffixes below
                }
                let suffixKeyvault = ".vault" + baseUri.substring(baseUri.indexOf('.')); // keyvault suffix starts with .
                let suffixStorage = baseUri.substring(baseUri.indexOf('.') + 1); // storage suffix starts without .
                let profileVersion = "2019-03-01-hybrid";
                await executeAzCliCommand(`cloud register -n "${environment}" --endpoint-resource-manager "${resourceManagerEndpointUrl}" --suffix-keyvault-dns "${suffixKeyvault}" --suffix-storage-endpoint "${suffixStorage}" --profile "${profileVersion}"`, false);
            }
            catch (error) {
                core.error(`Error while trying to register cloud "${environment}": "${error}"`);
            }

            console.log(`Done registering cloud: "${environment}"`)
        }

        // Switch to specified cloud
        await executeAzCliCommand(`cloud set -n "${environment}"`, false);
        console.log(`Done setting cloud: "${environment}"`);

        // Attempt az cli login
        var commonArgs = [""];

        // Check SubscriptionId
        if(subscriptionId){
            commonArgs = commonArgs.concat("--subscription", subscriptionId);
        }
        else if(allowNoSubscriptionsLogin){
            commonArgs = commonArgs.concat("--allow-no-subscriptions");
        }

        // Attempt az cli login using service principal with secret
        if (servicePrincipalId && tenantId && servicePrincipalKey) {
            if(!subscriptionId && !allowNoSubscriptionsLogin)
                throw new Error("SubscriptionId is mandatory if allow-no-subscriptions is not set.");
            }
            commonArgs = commonArgs.concat("--service-principal",
                "-u", servicePrincipalId,
                "--tenant", tenantId,
                "-p", servicePrincipalKey
            );
            try{
                console.log(`Attempting az cli login by using service principal with secret...\n
                            Note: Azure/login action also supports OIDC login mechanism.
                            If you want to use OIDC login, please do not input ClientSecret.
                            Refer https://github.com/azure/login#configure-a-service-principal-with-a-federated-
                            credential-to-use-oidc-based-authentication for more details.`);
                await executeAzCliCommand(`login`, false, loginOptions, commonArgs);
                if (!allowNoSubscriptionsLogin) {
                    var args = [
                        "--subscription",
                        subscriptionId
                    ];
                    await executeAzCliCommand(`account set`, false, loginOptions, args);
                }
                isAzCLISuccess = true;
            }
            catch (error){
                core.error(`${error}\n Failed with az cli login by using service principal with secret.`);
            }
        }

        // Attempt az cli login using service principal with OIDC
        if(servicePrincipalId && tenantId && !isAzCLISuccess){
            console.log('Attempting az cli login by using OIDC authentication...')
            // Generate ID-token for OIDC
            let audience = core.getInput('audience', { required: false });
            try{
                federatedToken = await core.getIDToken(audience);
            }
            catch (error) {
                core.error(`Please make sure to give write permissions to id-token in the workflow.`);
                throw error;
            }
            if (!!federatedToken) {
                let [issuer, subjectClaim] = await jwtParser(federatedToken);
                console.log("Federated token details: \n issuer - " + issuer + " \n subject claim - " + subjectClaim);
            }
            else{
                throw new Error("Failed to fetch federated token.");
            }
        }


        // Attempting Az cli login
        var commonArgs = ["--service-principal",
            "-u", servicePrincipalId,
            "--tenant", tenantId
        ];
        if (allowNoSubscriptionsLogin) {
            commonArgs = commonArgs.concat("--allow-no-subscriptions");
        }
        if (enableOIDC) {
            commonArgs = commonArgs.concat("--federated-token", federatedToken);
        }
        else {
            console.log("Note: Azure/login action also supports OIDC login mechanism. Refer https://github.com/azure/login#configure-a-service-principal-with-a-federated-credential-to-use-oidc-based-authentication for more details.")
            commonArgs = commonArgs.concat(`--password=${servicePrincipalKey}`);
        }
        await executeAzCliCommand(`login`, true, loginOptions, commonArgs);

        if (!allowNoSubscriptionsLogin) {
            var args = [
                "--subscription",
                subscriptionId
            ];
            await executeAzCliCommand(`account set`, true, loginOptions, args);
        }
        isAzCLISuccess = true;
        if (enableAzPSSession) {
            // Attempting Az PS login
            console.log(`Running Azure PS Login`);
            var spnlogin: ServicePrincipalLogin;

            spnlogin = new ServicePrincipalLogin(
                servicePrincipalId,
                servicePrincipalKey,
                federatedToken,
                tenantId,
                subscriptionId,
                allowNoSubscriptionsLogin,
                environment,
                resourceManagerEndpointUrl);
            await spnlogin.initialize();
            await spnlogin.login();
        }

        console.log("Login successful.");
    }
    catch (error) {
        if (!isAzCLISuccess) {
            core.setFailed(`Az CLI Login failed with ${error}. Please check the credentials and make sure az is installed on the runner. For more information refer https://aka.ms/create-secrets-for-GitHub-workflows`);
        }
        else {
            core.setFailed(`Azure PowerShell Login failed with ${error}. Please check the credentials and make sure az is installed on the runner. For more information refer https://aka.ms/create-secrets-for-GitHub-workflows`);
        }
    }
    finally {
        // Reset AZURE_HTTP_USER_AGENT
        core.exportVariable('AZURE_HTTP_USER_AGENT', prefix);
        core.exportVariable('AZUREPS_HOST_ENVIRONMENT', azPSHostEnv);
    }
}

async function executeAzCliCommand(
    command: string,
    silent?: boolean,
    execOptions: any = {},
    args: any = []) {
    execOptions.silent = !!silent;
    await exec.exec(`"${azPath}" ${command}`, args, execOptions);
}
async function jwtParser(federatedToken: string) {
    let tokenPayload = federatedToken.split('.')[1];
    let bufferObj = Buffer.from(tokenPayload, "base64");
    let decodedPayload = JSON.parse(bufferObj.toString("utf8"));
    return [decodedPayload['iss'], decodedPayload['sub']];
}
main();
