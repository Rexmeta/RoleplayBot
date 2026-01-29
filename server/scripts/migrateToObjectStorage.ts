import * as fs from 'fs';
import * as path from 'path';
import { ObjectStorageService } from '../replit_integrations/object_storage';
import { storage } from '../storage';

const objectStorage = new ObjectStorageService();

interface MigrationResult {
  success: boolean;
  migratedFiles: number;
  errors: string[];
}

async function uploadFileToObjectStorage(
  filePath: string,
  contentType: string
): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const uploadURL = await objectStorage.getObjectEntityUploadURL();
  
  const response = await fetch(uploadURL, {
    method: 'PUT',
    body: buffer,
    headers: {
      'Content-Type': contentType,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to upload: ${response.status}`);
  }

  const normalizedPath = objectStorage.normalizeObjectEntityPath(uploadURL);
  
  await objectStorage.trySetObjectEntityAclPolicy(uploadURL, {
    owner: 'system',
    visibility: 'public',
  });

  return normalizedPath;
}

async function migrateScenarioImages(): Promise<MigrationResult> {
  const result: MigrationResult = { success: true, migratedFiles: 0, errors: [] };
  const scenarioImagesDir = path.join(process.cwd(), 'scenarios', 'images');
  
  if (!fs.existsSync(scenarioImagesDir)) {
    console.log('📁 시나리오 이미지 디렉토리가 없습니다. 건너뜁니다.');
    return result;
  }

  const files = fs.readdirSync(scenarioImagesDir);
  console.log(`📁 시나리오 이미지 ${files.length}개 발견`);

  for (const file of files) {
    try {
      const filePath = path.join(scenarioImagesDir, file);
      const stat = fs.statSync(filePath);
      
      if (!stat.isFile()) continue;
      
      const ext = path.extname(file).toLowerCase();
      let contentType = 'image/webp';
      if (ext === '.png') contentType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      
      console.log(`  ⬆️ 업로드 중: ${file}`);
      const objectPath = await uploadFileToObjectStorage(filePath, contentType);
      console.log(`  ✅ 완료: ${objectPath}`);
      
      result.migratedFiles++;
    } catch (error: any) {
      console.error(`  ❌ 실패: ${file} - ${error.message}`);
      result.errors.push(`${file}: ${error.message}`);
    }
  }

  return result;
}

async function migrateScenarioVideos(): Promise<MigrationResult> {
  const result: MigrationResult = { success: true, migratedFiles: 0, errors: [] };
  const videosDir = path.join(process.cwd(), 'scenarios', 'videos');
  
  if (!fs.existsSync(videosDir)) {
    console.log('📁 비디오 디렉토리가 없습니다. 건너뜁니다.');
    return result;
  }

  const files = fs.readdirSync(videosDir);
  console.log(`📁 비디오 ${files.length}개 발견`);

  for (const file of files) {
    try {
      const filePath = path.join(videosDir, file);
      const stat = fs.statSync(filePath);
      
      if (!stat.isFile()) continue;
      
      const ext = path.extname(file).toLowerCase();
      let contentType = 'video/webm';
      if (ext === '.mp4') contentType = 'video/mp4';
      
      console.log(`  ⬆️ 업로드 중: ${file}`);
      const objectPath = await uploadFileToObjectStorage(filePath, contentType);
      console.log(`  ✅ 완료: ${objectPath}`);
      
      result.migratedFiles++;
    } catch (error: any) {
      console.error(`  ❌ 실패: ${file} - ${error.message}`);
      result.errors.push(`${file}: ${error.message}`);
    }
  }

  return result;
}

async function migratePersonaImages(): Promise<MigrationResult> {
  const result: MigrationResult = { success: true, migratedFiles: 0, errors: [] };
  const personasDir = path.join(process.cwd(), 'attached_assets', 'personas');
  
  if (!fs.existsSync(personasDir)) {
    console.log('📁 페르소나 이미지 디렉토리가 없습니다. 건너뜁니다.');
    return result;
  }

  const personaFolders = fs.readdirSync(personasDir);
  console.log(`📁 페르소나 ${personaFolders.length}개 발견`);

  for (const personaId of personaFolders) {
    const personaPath = path.join(personasDir, personaId);
    const stat = fs.statSync(personaPath);
    
    if (!stat.isDirectory()) continue;
    
    const genderFolders = fs.readdirSync(personaPath);
    
    for (const genderFolder of genderFolders) {
      const genderPath = path.join(personaPath, genderFolder);
      const genderStat = fs.statSync(genderPath);
      
      if (!genderStat.isDirectory()) continue;
      
      const imageFiles = fs.readdirSync(genderPath);
      
      for (const imageFile of imageFiles) {
        try {
          const imagePath = path.join(genderPath, imageFile);
          const imgStat = fs.statSync(imagePath);
          
          if (!imgStat.isFile()) continue;
          
          const ext = path.extname(imageFile).toLowerCase();
          if (!['.webp', '.png', '.jpg', '.jpeg'].includes(ext)) continue;
          
          let contentType = 'image/webp';
          if (ext === '.png') contentType = 'image/png';
          if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
          
          console.log(`  ⬆️ 업로드 중: ${personaId}/${genderFolder}/${imageFile}`);
          const objectPath = await uploadFileToObjectStorage(imagePath, contentType);
          console.log(`  ✅ 완료: ${objectPath}`);
          
          result.migratedFiles++;
        } catch (error: any) {
          console.error(`  ❌ 실패: ${personaId}/${genderFolder}/${imageFile} - ${error.message}`);
          result.errors.push(`${personaId}/${genderFolder}/${imageFile}: ${error.message}`);
        }
      }
    }
  }

  return result;
}

async function main() {
  console.log('🚀 Object Storage 마이그레이션 시작...\n');
  
  console.log('=== 시나리오 이미지 마이그레이션 ===');
  const scenarioResult = await migrateScenarioImages();
  
  console.log('\n=== 비디오 마이그레이션 ===');
  const videoResult = await migrateScenarioVideos();
  
  console.log('\n=== 페르소나 이미지 마이그레이션 ===');
  const personaResult = await migratePersonaImages();
  
  console.log('\n=== 마이그레이션 결과 ===');
  console.log(`시나리오 이미지: ${scenarioResult.migratedFiles}개 완료, ${scenarioResult.errors.length}개 오류`);
  console.log(`비디오: ${videoResult.migratedFiles}개 완료, ${videoResult.errors.length}개 오류`);
  console.log(`페르소나 이미지: ${personaResult.migratedFiles}개 완료, ${personaResult.errors.length}개 오류`);
  
  const totalMigrated = scenarioResult.migratedFiles + videoResult.migratedFiles + personaResult.migratedFiles;
  const totalErrors = scenarioResult.errors.length + videoResult.errors.length + personaResult.errors.length;
  
  console.log(`\n총 ${totalMigrated}개 파일 마이그레이션 완료, ${totalErrors}개 오류`);
  
  if (totalErrors > 0) {
    console.log('\n=== 오류 상세 ===');
    [...scenarioResult.errors, ...videoResult.errors, ...personaResult.errors].forEach(e => console.log(`  - ${e}`));
  }
}

main().catch(console.error);
