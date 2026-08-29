import config from './config.json';
import { emptyDirectory, explodeZip, login, postZip } from './epicenter';
import { stop } from './stop';
import { createZipFile } from './zip';

async function main() {
  console.log(
    'Deploy to',
    config.SERVER,
    config.ACCOUNT_SHORT_NAME,
    config.PROJECT_SHORT_NAME
  );

  const token = await login();
  console.log('Logged in ✓');

  const file = await createZipFile();
  console.log('Zip file created ✓');

  await emptyDirectory('proxy', token);
  console.log('Old files deleted ✓');

  await postZip('proxy', token)(file);
  console.log('File uploaded ✓');

  await explodeZip('proxy/deployment.zip', token);
  console.log('File exploded ✓');

  console.log('Deployment completed ✓');

  await stop(token);

  console.log('All done!');
}

if (require.main === module) main();
