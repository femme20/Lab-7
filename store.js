// Same load/edit/write-queue pattern as the professor's persistent API.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const products = [
  ['Vanos',120],['Ruby',95],['Rumi',145],['Nisha',95],['Milan',135],['Yazdaz',110]
].map(([name,price],i) => ({id:i+1,name,price,image:`images/${name.toLowerCase()}.jpg`}));
function createStore(file) {
  let queue = Promise.resolve();
  async function load() {
    try { return JSON.parse(await fs.readFile(file,'utf8')); }
    catch(error) {
      if (error.code !== 'ENOENT') throw error;
      return {users:[],sessions:[],products,carts:[],orders:[],reviews:[]};
    }
  }
  async function read() { await queue; return load(); }
  function edit(change) {
    const operation = queue.then(async () => {
      const data = await load();
      const result = change(data);
      await fs.mkdir(path.dirname(file),{recursive:true});
      const temp = file+'.'+randomUUID()+'.tmp';
      try {
        await fs.writeFile(temp, JSON.stringify(data,null,2));
        await fs.rename(temp,file);
      } catch(error) { await fs.rm(temp,{force:true}); throw error; }
      return result;
    });
    queue = operation.catch(()=>{});
    return operation;
  }
  return {read,edit};
}
module.exports = {createStore};
