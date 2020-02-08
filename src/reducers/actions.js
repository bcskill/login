import {
    ACTION_ALLOW_APP,
    ACTION_APP_INFO,
    ACTION_CREATE_INVITE,
    ACTION_CREATE_MY_APP,
    ACTION_DELETE_MY_APP, ACTION_EDIT_MY_APP,
    ACTION_GET_ALLOWED_APP,
    ACTION_GET_BALANCE,
    ACTION_GET_INVITE,
    ACTION_GET_INVITES,
    ACTION_GET_MY_APPS,
    ACTION_GET_MY_APPS_INFO, ACTION_GET_MY_SESSIONS,
    ACTION_INVITE,
    ACTION_LOCAL_AUTH,
    ACTION_LOGOUT,
    ACTION_RESTORE_MY_APP,
    ACTION_SELF_APP_INFO,
    ACTION_SESSION,
    ACTION_SIGNIN,
    ACTION_SIGNUP,
    getStatus,
    STATUS_COMPLETE,
    STATUS_FAIL,
    STATUS_INIT,
    STATUS_LOG,
    STATUS_MINED,
    STATUS_START,
    STATUS_SUCCESS
} from "./mainReducer";
import Signup, {SIGN_UP_INVITE} from "../Lib/get-login/signup";
import Signin, {LOGIN_DATA, LOGIN_USERNAME_PASSWORD} from "../Lib/get-login/signin";
import {CODE_EMPTY_METHOD_PARAM, LoginError} from "../Lib/get-login/login-error";
import {translate} from "../Lib/get-login/log-translation";
import {getUsernameHash, validateUserData} from "../Lib/get-login/utils";
import crypto from "../Lib/get-login/crypto";
import contract, {defaultAddresses} from "../Lib/get-login/contract";
import Invite from "../Lib/get-login/invite";
import Session from "../Lib/get-login/session";

const currentNetwork = 'rinkeby';
const smartContractAddress = defaultAddresses[currentNetwork];
let cryptoInstance = crypto.getInstance();
let contractInstance = new contract(cryptoInstance.web3, currentNetwork, smartContractAddress);
let dispatch = null;
let signup = null;
let signin = null;
/**
 *
 * @type Session
 */
let session = null;
/**
 *
 * @type Invite
 */
let invite = null;

export const web3 = cryptoInstance.web3;

export const doDispatch = (type, data = {}) => {
    dispatch({type, data});
};

export const init = (dispatch) => {
    const getLogger = (action) => {
        return {
            log: (type, data) => {
                console.log(type, data);
                const message = translate(type);
                console.log(message);
                doDispatch(getStatus(action, STATUS_LOG), message);
            }
        };
    };
    setDispatch(dispatch);
    // todo move init to lib class?
    signup = new Signup(cryptoInstance, contractInstance);
    signin = new Signin(cryptoInstance, contractInstance);
    invite = new Invite(cryptoInstance, contractInstance);
    session = new Session(cryptoInstance, contractInstance);
    signup.setLogger(getLogger(ACTION_SIGNUP));
    signin.setLogger(getLogger(ACTION_SIGNIN));
    invite.setLogger(getLogger(ACTION_INVITE));
    session.setLogger(getLogger(ACTION_SESSION));
    checkLocalCredentials().then();
    doDispatch(getStatus(ACTION_SELF_APP_INFO, STATUS_INIT), {
        network: currentNetwork,
        smartContractAddress,
        provider: cryptoInstance.config.websocketProviderUrl
    });
};

export const checkLocalCredentials = async () => {
    return callMethod(ACTION_LOCAL_AUTH, async () => {
        const data = getUserData();
        await validateUserData(data);
        contractInstance.setPrivateKey(data.wallet.privateKey);
        cryptoInstance.setAccount(data.wallet.privateKey);
        getWalletBalance(data.wallet.address).then();
        setInterval(_ => {
            getWalletBalance(data.wallet.address).then();
        }, 30000);
        const redirectUrl = window.sessionStorage.getItem('redirect_url');
        if (redirectUrl) {
            window.location.replace(redirectUrl);
            window.sessionStorage.removeItem('redirect_url')
        }

        return data;
    });
};

export const getWalletBalance = async (wallet) => {
    return callMethod(ACTION_GET_BALANCE, async () => cryptoInstance.web3.eth.getBalance(wallet)
        .then(data => {
            const original = cryptoInstance.web3.utils.fromWei(data);
            // todo fix situation when 3.65898484 displays as 3.66
            const web = Number(original).toFixed(2);
            return {
                original,
                web
            };
        }), wallet);
};

export const setDispatch = (newDispatch) => {
    dispatch = newDispatch;
};

export const getDispatch = () => {
    return dispatch;
};

export const signIn = async (method, username, password, wallet) => {
    // todo reset all state because new user
    return callMethod(ACTION_SIGNIN, async () => {
        const usernameHash = getUsernameHash(cryptoInstance.web3, username);
        const receivedWallet = await signin.signIn(method, username, password, wallet);
        if (method === LOGIN_DATA) {
            setUserData(username, wallet);
        } else if (method === LOGIN_USERNAME_PASSWORD) {
            setUserData(username, receivedWallet);
        } else {
            throw new Error('Not supported method for local storing');
        }

        return {username, usernameHash};
    })
        .then(() => checkLocalCredentials());
};

export const signUp = async (method, username, password = '', invite = '') => {
    /** @type {IInviteRegistration} */
    const result = await callMethod(ACTION_SIGNUP, async () => {
        return await signup.signUp(method, username, password, invite, info => {
            doDispatch(getStatus(ACTION_SIGNUP, STATUS_MINED), info);
        });
    });

    if (result && [SIGN_UP_INVITE/*, LOGIN_WEB3, LOGIN_TREZOR*/].includes(method)) {
        if (method === SIGN_UP_INVITE) {
            method = LOGIN_DATA;
        }

        setUserData(username, result.decryptedWallet);
        await checkLocalCredentials();
    }

    return result;
};

export const logoutLocal = () => {
    return callMethod(ACTION_LOGOUT, async () => {
        localStorage.clear();
        return true;
    });
};

export const setUserData = (username, wallet) => {
    if (username) {
        localStorage.setItem('username', username);
        localStorage.setItem('usernameHash', getUsernameHash(cryptoInstance.web3, username));
    } else {
        localStorage.removeItem('username');
        localStorage.removeItem('usernameHash');
    }

    if (wallet) {
        if (typeof wallet === 'object') {
            wallet = JSON.stringify(wallet);
        }

        localStorage.setItem('wallet', wallet);
    } else {
        localStorage.removeItem('wallet');
    }

    return true;
};

export const getUserData = () => {
    const username = localStorage.getItem('username');
    const wallet = JSON.parse(localStorage.getItem('wallet'));
    const usernameHash = localStorage.getItem('usernameHash');

    return {username, wallet, usernameHash};
};

export const getLocalUsernameHash = () => {
    return getUserData()['usernameHash'];
};

export const getLocalUsername = () => {
    return getUserData()['username'];
};

export const initPage = (pageAction) => {
    doDispatch(getStatus(pageAction, STATUS_INIT));
};

export const getAppInfo = async (appId) => {
    return callMethod(ACTION_APP_INFO, async () => await contractInstance.getApplication(appId), appId);
};

export const getAppsInfo = async (appIds) => {
    return callMethod(ACTION_GET_MY_APPS_INFO, async () => {
        let result = {};
        for (const appId of appIds) {
            result[appId] = await contractInstance.getAnyApplication(appId);
        }

        return result;
    }, appIds);
};

export const allowApp = async (appId) => {
    return await callMethod(ACTION_ALLOW_APP, async () => {
        const sessionInfo = await session.createSession(appId);

        return setRawAccessToken(appId, {
            transactionHash: sessionInfo.createdSession.transactionHash,
            privateKey: sessionInfo.wallet.privateKey
        });
    }, {appId});
};

export const getAllowedApp = async (appId) => {
    return callMethod(ACTION_GET_ALLOWED_APP, async () => {
        if (!appId) {
            throw new Error('Empty appId');
        }

        const usernameHash = getLocalUsernameHash();
        if (!usernameHash) {
            throw new Error('Empty username');
        }

        const appToken = getAccessToken(appId);
        if (appToken) {
            return appToken;
        } else {
            const sessionInfo = await session.getSessionInfo(appId, usernameHash);

            return setRawAccessToken(appId, sessionInfo);
        }
    }, {appId});
};

const accessTokenKey = 'allowed_apps';
const getAccessToken = (appId) => {
    const data = getAllAccessTokens()[appId];
    if (!data) {
        return null;
    }

    return typeof data === 'string' ? JSON.parse(data) : data;
};

const setRawAccessToken = (appId, rawTokenInfo) => {
    const allTokens = getAllAccessTokens();
    allTokens[appId] = {
        privateKey: rawTokenInfo.privateKey,
        transactionHash: rawTokenInfo.transactionHash
    };
    saveAllAccessTokens(allTokens);

    return getAccessToken(appId);
};

const getAllAccessTokens = () => {
    let allowedApps = localStorage.getItem(accessTokenKey);
    if (typeof allowedApps !== 'string') {
        allowedApps = '{}';
    }

    allowedApps = JSON.parse(allowedApps);
    if (typeof allowedApps !== 'object') {
        allowedApps = {};
    }

    return allowedApps;
};

const saveAllAccessTokens = (data) => {
    localStorage.setItem(accessTokenKey, JSON.stringify(data));
};

export const getInvites = async (usernameHash) => {
    return callMethod(ACTION_GET_INVITES, async () => await contractInstance.getInvites(usernameHash));
};

export const getInvite = async (address) => {
    return callMethod(ACTION_GET_INVITE, async () => await contractInstance.getInvite(address));
};

export const createInvite = async () => {
    return callMethod(ACTION_CREATE_INVITE, async () => await invite.createInvite());
};

/*export const getApps = async (usernameHash) => {
    return callMethod(ACTION_GET_MY_APPS, async () => await contractInstance.getApps(usernameHash));
};*/

export const getMyApps = async () => {
    return callMethod(ACTION_GET_MY_APPS, async () => await contractInstance.getApps(getLocalUsernameHash()));
};

export const createApplication = async (title, description, allowedUrls = [], allowedContracts = []) => {
    return callMethod(ACTION_CREATE_MY_APP, async () => await contractInstance.createApplication(title, description, allowedUrls, allowedContracts));
};

export const editApplication = async (id, title, description, allowedUrls = [], allowedContracts = []) => {
    return callMethod(ACTION_EDIT_MY_APP, async () => await contractInstance.editApplication(id, title, description, allowedUrls, allowedContracts));
};

export const deleteApplication = async (id) => {
    return callMethod(ACTION_DELETE_MY_APP, async () => await contractInstance.deleteApplication(id));
};

export const restoreApplication = async (id) => {
    return callMethod(ACTION_RESTORE_MY_APP, async () => await contractInstance.restoreApplication(id));
};

export const getMySessions = async () => {
    return callMethod(ACTION_GET_MY_SESSIONS, async () => await contractInstance.getSessions(getLocalUsernameHash()));
};

export const test = async () => {
    return callMethod('my_test', async () => {

    });
};

export const callMethod = async (actionName, func, startData = null) => {
    let result = null;
    try {
        doDispatch(getStatus(actionName, STATUS_START), startData);
        if (!func) {
            throw new LoginError(CODE_EMPTY_METHOD_PARAM);
        }

        result = await func();
        doDispatch(getStatus(actionName, STATUS_SUCCESS), result);
    } catch (error) {
        // todo not log error, but pass correct filenames to dispatch
        console.log(error);
        doDispatch(getStatus(actionName, STATUS_FAIL), error);
    }

    doDispatch(getStatus(actionName, STATUS_COMPLETE));

    return result;
};
