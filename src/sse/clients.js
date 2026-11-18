const clients = new Set();

module.exports = {
  add(res) {
    clients.add(res);
    return clients.size;
  },
  remove(res) {
    clients.delete(res);
    return clients.size;
  },
  count() {
    return clients.size;
  }
};
