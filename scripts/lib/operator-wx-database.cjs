/* eslint-env node */
// wx-server-sdk takes set({data}); its paired operator SDK takes set(data).
function operatorWxDatabase(database) {
  const wrap = (db) => ({
    command: db.command,
    collection(name) {
      const collection = db.collection(name);
      return {
        where: (filter) => collection.where(filter),
        doc(id) {
          const document = collection.doc(id);
          return {
            get: () => document.get(),
            set: async ({ data }) => {
              const result = await document.set(data);
              if (!result || result.code) throw new Error('Operator document write failed');
              return result;
            },
            remove: () => document.remove(),
          };
        },
      };
    },
  });
  const adapted = wrap(database);
  adapted.runTransaction = (work) => database.runTransaction((tx) => work(wrap(tx)));
  return adapted;
}
module.exports = { operatorWxDatabase };
