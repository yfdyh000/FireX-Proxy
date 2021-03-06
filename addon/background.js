import { ProxyProvider } from "./proxyProvider.js";
import { Addresses } from "./addresses.js";
import { isChrome, versionCompare } from "./helpers.js";
import { Connector } from "./connector.js";
import { Address } from "./address.js";

let proxyListSession  = new Addresses();
let blacklistSession  = {};
let blacklistSettings = {};
let proxyProvider     = new ProxyProvider();

if (!isChrome() && browser.proxy.register) {
    browser.proxy.register('addon/pac/firefox.js');
}

let pacMessageConfiguration = {
    toProxyScript: true
};

browser.storage.local.get()
    .then(
        storage => {
            proxyListSession = proxyListSession.concat(
                ...(storage.favorites || [])
                    .map(element => Object.assign(new Address(), element))
            );

            blacklistSession  = storage.blacklist || {};
            blacklistSettings = storage.blacklistSettings || {};

            if (!isChrome()) {
                browser.runtime.sendMessage({
                    blacklist: blacklistSession,
                    isBlacklistEnabled: blacklistSettings.isBlacklistEnabled
                }, pacMessageConfiguration);
            }
        }
);

browser.storage.onChanged.addListener(
    newSettings => {
        if (newSettings.blacklistSettings || newSettings.blacklist) {
            if (!isChrome()) {
                browser.runtime.sendMessage({
                    blacklist: blacklistSession,
                    isBlacklistEnabled: blacklistSettings.isBlacklistEnabled
                }, pacMessageConfiguration);
            } else {
                let enabledArray = proxyListSession.filterEnabled();

                if (!enabledArray.isEmpty()) {
                    Connector.connect(
                        enabledArray.one(),
                        blacklistSession,
                        blacklistSettings
                    );
                }
            }
        }
    }
);

/**
 * Local storage data
 */

browser.runtime.onInstalled.addListener(
    details => {
        const { reason, previousVersion } = details;

        switch (reason) {
            case 'update':
                if (versionCompare(previousVersion, browser.runtime.getManifest().version) === -1) {
                    browser.tabs.create({
                        url: '../welcome/index.html'
                    });
                }

                break;
        }
    }
);

browser.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {
        switch (request.name) {
            /**
             * Get proxy list
             */
            case 'get-proxy-list':
                if (proxyListSession.byExcludeFavorites().isEmpty() || request.force) {
                    let activeProxies = proxyListSession.filterEnabled();

                    proxyProvider
                        .getProxies()
                        .then(response => {
                            let result = response
                                .map(proxy => {
                                    return (new Address())
                                        .setIPAddress(proxy.server)
                                        .setPort(proxy.port)
                                        .setCountry(proxy.country)
                                        .setProtocol(proxy.protocol)
                                        .setPingTimeMs(proxy.pingTimeMs)
                                        .setIsoCode(proxy.isoCode);
                                });

                            proxyListSession = proxyListSession
                                .byFavorite()
                                .concat(activeProxies)
                                .concat(result);

                            sendResponse(proxyListSession.unique());
                        });

                    break;
                }

                sendResponse(proxyListSession.unique());

                break;
            /**
             * Proxy connect
             */
            case 'connect':
                Connector.connect(
                    proxyListSession
                        .disableAll()
                        .byIpAddress(request.message['ipAddress'])
                        .byPort(request.message['port'])
                        .one()
                        .enable(),
                    blacklistSession,
                    blacklistSettings
                );

                sendResponse(proxyListSession);

                break;
            /**
             * Proxy disconnect
             */
            case 'disconnect':
                Connector
                    .disconnect()
                    .then(
                        () => proxyListSession.disableAll()
                    );

                sendResponse(proxyListSession);

                break;
            /**
             * Toggle favorite state
             */
            case 'toggle-favorite':
                proxyListSession
                    .byIpAddress(request.message['ipAddress'])
                    .byPort(request.message['port'])
                    .one()
                    .toggleFavorite();

                /**
                 * Store favorites
                 */
                browser.storage.local.set({
                    favorites: [...proxyListSession.byFavorite()]
                });

                sendResponse(proxyListSession);

                break;
            /**
             * Remove an element from blacklist
             */
            case 'remove-blacklist':
                delete blacklistSession[request.message['address']];

                browser.storage.local.set({
                    blacklist: blacklistSession
                });

                break;
            /**
             * Add an element to blacklist
             */
            case 'add-blacklist':
                blacklistSession[request.message['address']] = request.message['isEnabled'];

                browser.storage.local.set({
                    blacklist: blacklistSession
                });

                break;
            /**
             * Read blacklist
             */
            case 'get-blacklist':
                sendResponse(blacklistSession);

                break;
            case 'get-blacklist-settings':
                sendResponse(blacklistSettings);

                break;
            case 'change-blacklist-settings':
                blacklistSettings = request.message;

                browser.storage.local.set({
                    blacklistSettings: blacklistSettings
                });

                break;
        }

        return true;
    }
);
