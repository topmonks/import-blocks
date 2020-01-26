const Web3 = require('web3');
const Promise = require('bluebird');
const Influx = require('influx');
const Progress = require('progress');

const nodeUrl = "http://192.168.1.26:5444";
const dbUrl = "http://192.168.1.26:8086/rsk";
const measurement = 'block';

const web3 = new Web3(new Web3.providers.HttpProvider(nodeUrl), null, {});
const db = new Influx.InfluxDB(dbUrl);
let start = process.argv[2];
let end = process.argv[3];
const auto = !start && !end;

const range = (start, end) => {
  if (start === null || end === null || start > end) {
    throw new Error("both start and end block has to be specified as args");
  }
  let nums = [];
  for (let i = start; i <= end; i++) nums.push(i);
  return nums;
};
const fields = block => {
  const {number, miner, timestamp, gasUsed, gasLimit, size} = block;
  return {
    measurement,
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
  await db.query('CREATE DATABASE rsk WITH SHARD DURATION 30d NAME myrp');
  if (auto) {
    start = await db.query(`SELECT max("number") FROM "${measurement}"`).then(([res]) => res && res.max) + 1 || 0;
    end = await web3.eth.getBlockNumber();
  }
  const blocks = range(start, end);
  console.log(`importing blocks ${start} -> ${end}`);
  const bar = new Progress('[:bar] :current/:total :ratebps :etas',{total: blocks.length});
  await Promise.map(
    blocks,
    num => web3.eth.getBlock(num)
      .then(fields)
      .then(async data => {
        await db.writePoints([data]);
        bar.tick();
      }),
    {concurrency: 200});
}

stats().catch(e => {
  console.log(e);
  process.exit(1);
});