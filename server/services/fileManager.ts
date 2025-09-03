import * as fs from 'fs/promises';
import * as path from 'path';
import { ComplexScenario, ScenarioPersona } from '@/lib/scenario-system';

const SCENARIOS_DIR = 'scenarios';
const PERSONAS_DIR = 'personas';

export class FileManagerService {
  
  // 시나리오 관리
  async getAllScenarios(): Promise<ComplexScenario[]> {
    try {
      const files = await fs.readdir(SCENARIOS_DIR);
      const scenarios: ComplexScenario[] = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenario = JSON.parse(content) as ComplexScenario;
          scenarios.push(scenario);
        } catch (error) {
          console.warn(`Failed to load scenario file ${file}:`, error);
        }
      }
      
      return scenarios;
    } catch (error) {
      console.error('Failed to read scenarios directory:', error);
      return [];
    }
  }

  async createScenario(scenario: Omit<ComplexScenario, 'id'>): Promise<ComplexScenario> {
    const id = this.generateId(scenario.title);
    const newScenario: ComplexScenario = { ...scenario, id };
    
    const fileName = `${id}.json`;
    const filePath = path.join(SCENARIOS_DIR, fileName);
    
    await fs.writeFile(filePath, JSON.stringify(newScenario, null, 2), 'utf-8');
    return newScenario;
  }

  async updateScenario(id: string, scenario: Partial<ComplexScenario>): Promise<ComplexScenario> {
    try {
      // 모든 시나리오 파일을 검색해서 ID가 일치하는 파일 찾기
      const files = await fs.readdir(SCENARIOS_DIR);
      let foundFile: string | null = null;
      let existingScenario: ComplexScenario | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenarioData = JSON.parse(content) as ComplexScenario;
          if (scenarioData.id === id) {
            foundFile = file;
            existingScenario = scenarioData;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read scenario file ${file}:`, error);
        }
      }
      
      if (!foundFile || !existingScenario) {
        throw new Error(`Scenario ${id} not found`);
      }
      
      const updatedScenario = { ...existingScenario, ...scenario, id };
      const filePath = path.join(SCENARIOS_DIR, foundFile);
      
      await fs.writeFile(filePath, JSON.stringify(updatedScenario, null, 2), 'utf-8');
      return updatedScenario;
    } catch (error) {
      throw new Error(`Scenario ${id} not found: ${error}`);
    }
  }

  async deleteScenario(id: string): Promise<void> {
    try {
      // 모든 시나리오 파일을 검색해서 ID가 일치하는 파일 찾기
      const files = await fs.readdir(SCENARIOS_DIR);
      let foundFile: string | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenarioData = JSON.parse(content) as ComplexScenario;
          if (scenarioData.id === id) {
            foundFile = file;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read scenario file ${file}:`, error);
        }
      }
      
      if (!foundFile) {
        throw new Error(`Scenario ${id} not found`);
      }
      
      const filePath = path.join(SCENARIOS_DIR, foundFile);
      await fs.unlink(filePath);
    } catch (error) {
      throw new Error(`Failed to delete scenario ${id}: ${error}`);
    }
  }

  // 페르소나 관리
  async getAllPersonas(): Promise<ScenarioPersona[]> {
    try {
      const files = await fs.readdir(PERSONAS_DIR);
      const personas: ScenarioPersona[] = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8');
          const persona = JSON.parse(content) as ScenarioPersona;
          personas.push(persona);
        } catch (error) {
          console.warn(`Failed to load persona file ${file}:`, error);
        }
      }
      
      return personas;
    } catch (error) {
      console.error('Failed to read personas directory:', error);
      return [];
    }
  }

  async createPersona(persona: Omit<ScenarioPersona, 'id'>): Promise<ScenarioPersona> {
    const id = this.generateId(persona.name);
    const newPersona: ScenarioPersona = { ...persona, id };
    
    const fileName = `${id}.json`;
    const filePath = path.join(PERSONAS_DIR, fileName);
    
    await fs.writeFile(filePath, JSON.stringify(newPersona, null, 2), 'utf-8');
    return newPersona;
  }

  async updatePersona(id: string, persona: Partial<ScenarioPersona>): Promise<ScenarioPersona> {
    try {
      // 모든 페르소나 파일을 검색해서 ID가 일치하는 파일 찾기
      const files = await fs.readdir(PERSONAS_DIR);
      let foundFile: string | null = null;
      let existingPersona: ScenarioPersona | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8');
          const personaData = JSON.parse(content) as ScenarioPersona;
          if (personaData.id === id) {
            foundFile = file;
            existingPersona = personaData;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read persona file ${file}:`, error);
        }
      }
      
      if (!foundFile || !existingPersona) {
        throw new Error(`Persona ${id} not found`);
      }
      
      const updatedPersona = { ...existingPersona, ...persona, id };
      const filePath = path.join(PERSONAS_DIR, foundFile);
      
      await fs.writeFile(filePath, JSON.stringify(updatedPersona, null, 2), 'utf-8');
      return updatedPersona;
    } catch (error) {
      throw new Error(`Persona ${id} not found: ${error}`);
    }
  }

  async deletePersona(id: string): Promise<void> {
    try {
      // 모든 페르소나 파일을 검색해서 ID가 일치하는 파일 찾기
      const files = await fs.readdir(PERSONAS_DIR);
      let foundFile: string | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8');
          const personaData = JSON.parse(content) as ScenarioPersona;
          if (personaData.id === id) {
            foundFile = file;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read persona file ${file}:`, error);
        }
      }
      
      if (!foundFile) {
        throw new Error(`Persona ${id} not found`);
      }
      
      const filePath = path.join(PERSONAS_DIR, foundFile);
      await fs.unlink(filePath);
    } catch (error) {
      throw new Error(`Failed to delete persona ${id}: ${error}`);
    }
  }

  // 유틸리티 메서드
  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
}

export const fileManager = new FileManagerService();