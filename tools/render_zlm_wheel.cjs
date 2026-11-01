// After prepare_zlm_assets.py: GC_SHARP may point to the bundled sharp module.
const sharp=require(process.env.GC_SHARP||'sharp'),path=require('path');
(async()=>{
 if(!process.argv[2])throw Error('Pass extracted package directory');
 for(const name of ['wheel-turn','wheel-fixed'])await sharp(path.join(process.argv[2],name+'.svg')).resize(1700,1700).webp({quality:93}).toFile(path.join(__dirname,'../docs/img/zlm',name+'.webp'));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
