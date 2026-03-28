const { Bonjour } = require('bonjour-service');

function startDiscovery({ port, name }) {
  const bonjour = new Bonjour();
  const peers = new Map();

  const service = bonjour.publish({
    name,
    type: 'lanmsg',
    protocol: 'tcp',
    port,
    txt: { app: 'local-chat', version: '1.0.0' }
  });

  const browser = bonjour.find({ type: 'lanmsg', protocol: 'tcp' }, (s) => {
    const key = `${s.fqdn || s.name}:${s.port}`;
    peers.set(key, {
      name: s.name,
      host: s.host,
      port: s.port,
      addresses: s.addresses || [],
      fqdn: s.fqdn || ''
    });
  });

  return {
    listPeers() {
      return Array.from(peers.values());
    },
    stop() {
      browser.stop();
      service.stop();
      bonjour.destroy();
    }
  };
}

module.exports = { startDiscovery };
