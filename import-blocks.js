const Promise = require('bluebird');
const Progress = require('progress');
const program = require('commander');
const Web3 = require('web3');
const Influx = require('influx');

program
  .option('-t, --transactions', 'import transactions')
  .option('-s, --start <block>', 'import from block number')
  .option('-e, --end <block>', 'import to block number')
  .option('-u, --url <server>', 'node url')
  .option('-d, --db <url>', 'influx db url');
program.parse(process.argv);

const nodeUrl = program.url || "http://192.168.1.26:5444";
const dbUrl = program.db || "http://192.168.1.26:8086/rsk";
const concurrency = 200;

const web3 = new Web3(new Web3.providers.HttpProvider(nodeUrl), null, {});
const db = new Influx.InfluxDB(dbUrl);
let {start, end, transactions} = program;
const auto = !start && !end;

const range = (start, end) => {
  if (start === null || end === null || start > end) {
    throw new Error("both start and end block has to be specified as args");
  }
  let nums = [];
  for (let i = start; i <= end; i++) nums.push(i);
  return nums;
};

const blockMeasurement = block => {
  const {number, miner, timestamp, gasUsed, gasLimit, size, hash} = block;
  return {
    measurement: 'block',
    tags: {miner},
    timestamp: timestamp*1000000000,
    fields: {
      number, gasUsed, gasLimit, size, hash,
      transactions: block.transactions.length,
      uncles: block.uncles.length,
      minimumGasPrice: Number(web3.utils.fromWei(block.minimumGasPrice, 'gwei')),
      difficulty: Number(web3.utils.fromWei(block.difficulty, 'ether')),
      paidFees: Number(web3.utils.fromWei(block.paidFees, 'gwei')),
      totalDifficulty: Number(web3.utils.fromWei(block.totalDifficulty, 'mether'))
    }
  }
};

const transactionMeasurement = (tx, block) => {
  const {from, to, transactionIndex, gas, hash, blockNumber, input} = tx;
  return {
    measurement: 'transaction',
    tags: {from, to, transactionIndex},
    timestamp: block.timestamp*1000000000,
    fields: {
      hash, gas, blockNumber, input,
      value: Number(web3.utils.fromWei(tx.value, 'ether')),
      gasPrice: Number(web3.utils.fromWei(tx.gasPrice, 'gwei'))
    }
  }

};

async function stats() {
  await db.query('CREATE DATABASE rsk WITH SHARD DURATION 30d NAME myrp');
  if (!start || !end) {
    start = start || await db.query('SELECT max("number") FROM "block"').then(([res]) => res && res.max) + 1 || 0;
    end = end || await web3.eth.getBlockNumber();
  }
  const blocks = range(start, end);
  console.log(`importing blocks ${transactions ? 'with tra' +
    'nsactions' : ''} ${start} -> ${end}`);
  const bar = new Progress('[:bar] :current/:total :ratebps :etas',{total: blocks.length});
  await Promise.map(
    blocks,
    num => web3.eth.getBlock(num)
      .then(async block => {
        let points = [blockMeasurement(block)];
        if (transactions) {
          await Promise.map(block.transactions, async txHash => {
            const tx = await web3.eth.getTransaction(txHash);
            points.push(transactionMeasurement(tx, block));
          }, {concurrency});
        }
        return points;
      }).then(async points => {
        await db.writePoints(points);
        bar.tick();
      }),
    {concurrency});
}

stats().catch(e => {
  console.log(e);
  process.exit(1);
});