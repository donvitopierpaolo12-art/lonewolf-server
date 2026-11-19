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
  },
  closeAll() {
    const list = [...clients];
    list.forEach((res) => {
      try {
        res.end();
      } catch (err) {
        try {
          res.destroy();
        } catch (ignored) {}
      }
    });
    return list.length;
  }
};
