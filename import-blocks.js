const Web3 = require('web3');
const Promise = require('bluebird');
const Influx = require('influx');
const progress = require('cli-progress');

const nodeUrl = "http://192.168.1.26:5444";
const dbUrl = "http://192.168.1.26:8086/rsk";

const web3 = new Web3(new Web3.providers.HttpProvider(nodeUrl), null, {});
const db = new Influx.InfluxDB(dbUrl);
const start =

const range = (start, end) => {
  let nums = [];
  for (let i = start; i <= end; i++) nums.push(i);
  return nums;
};

const fields = block => {
  const {number, miner, timestamp, gasUsed, gasLimit, size} = block;
  return {
    measurement: 'block',
    tags: {miner},
    timestamp: timestamp*1000000000,
    fields: {
      number, gasUsed, gasLimit, size,
      transactions: block.transactions.length,
      uncles: block.uncles.length,
      minimumGasPrice: Number(web3.utils.fromWei(block.minimumGasPrice, 'gwei')),
      difficulty: Number(web3.utils.fromWei(block.difficulty, 'ether')),
      paidFees: Number(web3.utils.fromWei(block.paidFees, 'gwei')),
      totalDifficulty: Number(web3.utils.fromWei(block.totalDifficulty, 'mether'))
    }
  }
};

async function stats() {
  console.log(new Date());
  await db.query('CREATE DATABASE rsk WITH SHARD DURATION 30d NAME myrp');
  const blocks = await Promise.map(
    range(0, 500000),
    num => web3.eth.getBlock(num)
      .then(fields)
      .then(async data => {
        await db.writePoints([data]);
        if (data.number % 1000 === 0) {
          console.log('written block ' + data.number);
        }
      }),
    {concurrency: 200});
  console.log(blocks);
  console.log(new Date());
}

stats().catch(e => {
  console.log(e);
  process.exit(1);
});