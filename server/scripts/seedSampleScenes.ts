import { db } from '../storage';
import { personaUserScenes } from '@shared/schema';
import { eq } from 'drizzle-orm';

const SYSTEM_CREATOR_ID = 'system';

const SAMPLE_SCENES = [
  {
    id: 'sample-scene-rainy-cafe',
    title: '비 오는 골목 카페',
    description: '비 내리는 저녁, 골목 안에 숨어 있는 작은 카페에서 우연히 마주치는 이야기.',
    setting: '좁은 골목 안에 자리한 아담한 카페. 빗소리가 창밖에서 은은하게 들리고, 창가 자리에는 김이 모락모락 오르는 커피잔이 놓여 있다. 따뜻한 조명과 재즈 음악이 흐르는 오후 늦게, 당신과 나는 같은 자리를 두고 눈이 마주쳤다.',
    mood: '차분하고 감성적인',
    openingLine: '어, 저도 이 자리 보고 왔는데... 혹시 같이 앉아도 될까요? 비가 너무 와서 다른 데는 다 찼더라고요.',
    genre: '일상/로맨스',
    tags: ['일상', '로맨스', '카페', '비', '우연한만남'],
  },
  {
    id: 'sample-scene-midnight-store',
    title: '심야 편의점',
    description: '새벽 2시, 텅 빈 편의점에서 마주친 묘한 분위기의 알바생.',
    setting: '새벽 두 시의 편의점. 형광등 불빛이 유난히 밝고 바깥은 적막하다. 손님이라곤 당신 하나뿐인 이 공간에서, 계산대 너머 알바생은 책 대신 오래된 일기장을 읽고 있다. 창밖으로 간간이 빗방울이 유리를 두드린다.',
    mood: '묘하고 고요한',
    openingLine: '어서 오세요... 이 시간에 오시는 분은 보통 사연이 있더라고요. 뭐 드실 거 찾으세요, 아니면 그냥 어디 있고 싶으셨던 거예요?',
    genre: '일상/미스터리',
    tags: ['일상', '미스터리', '심야', '편의점', '분위기'],
  },
  {
    id: 'sample-scene-magic-library',
    title: '마법 아카데미 도서관',
    description: '금서가 보관된 아카데미 도서관 지하, 금지된 마법 연구를 함께 하게 된 이야기.',
    setting: '아카데미 도서관 지하 3층. 허가 없이는 들어올 수 없는 이 구역에 오래된 마법서들이 빼곡히 꽂혀 있다. 공기 중에는 양피지 냄새와 희미한 마법 잔향이 떠돌고, 촛불이 천장에 그림자를 드리운다. 당신이 찾는 책은 가장 어두운 서가 끝에 있다.',
    mood: '신비롭고 긴장된',
    openingLine: '여기까지 혼자 내려온 거야? 허가증도 없이? ... 뭘 찾고 있는지 말해봐. 내가 아는 책이라면 안내해줄 수 있어.',
    genre: '판타지',
    tags: ['판타지', '마법', '도서관', '아카데미', '신비'],
  },
  {
    id: 'sample-scene-space-observatory',
    title: '우주 정거장 관측실',
    description: '지구에서 400km 떨어진 우주 정거장, 광활한 우주를 바라보며 나누는 대화.',
    setting: '국제 우주 정거장의 관측 돔. 둥근 유리창 너머로 별이 가득한 우주와 푸른 지구가 한눈에 보인다. 무중력 상태에서 두 사람은 손잡이에 몸을 고정한 채 나란히 우주를 바라보고 있다. 지구로 귀환하기까지 48시간이 남았다.',
    mood: '경이롭고 고독한',
    openingLine: '저 아래가 지구야. 저렇게 작은 곳에서 그 많은 일들이 일어나고 있다는 게... 가끔 실감이 안 돼. 넌 지구가 그립지 않아?',
    genre: 'SF',
    tags: ['SF', '우주', '정거장', '지구', '철학적'],
  },
  {
    id: 'sample-scene-detective-office',
    title: '사립 탐정 사무소',
    description: '비밀을 추적하는 사립 탐정 사무소, 의뢰인으로 찾아온 당신과 탐정의 이야기.',
    setting: '낡은 빌딩 4층에 자리한 사립 탐정 사무소. 블라인드 사이로 비가 쏟아지는 거리가 내려다보이고, 책상 위에는 미제 사건 파일과 식은 커피가 놓여 있다. 형광등 하나가 깜빡이고, 당신은 문을 두드리고 들어섰다.',
    mood: '긴장감 있는',
    openingLine: '문은 열려 있었어. 앉아요. 의뢰 내용은 천천히 들을 테니까, 처음부터 빠짐없이 얘기해요. 거짓말은 금방 눈에 띄니까 괜히 숨기려 하지 말고.',
    genre: '미스터리/누아르',
    tags: ['미스터리', '누아르', '탐정', '추리', '긴장'],
  },
  {
    id: 'sample-scene-hangang-night',
    title: '한강 공원 야경',
    description: '한강 공원 벤치에서 야경을 바라보며 시작되는 따뜻한 봄밤의 이야기.',
    setting: '봄밤의 한강 공원. 강 위로 서울의 불빛이 반짝이고, 멀리서 불꽃놀이 소리가 들려온다. 벤치에 나란히 앉아 편의점 캔맥주를 손에 든 두 사람. 봄바람이 살짝 불고, 어디선가 벚꽃 잎이 날아온다.',
    mood: '따뜻하고 낭만적인',
    openingLine: '오늘 여기 오길 잘한 것 같다. 이런 야경은 혼자 보기엔 아까우니까. 너는 이런 거 좋아해? 아무 말 없이 그냥 이렇게 앉아 있는 거.',
    genre: '로맨스/일상',
    tags: ['로맨스', '한강', '야경', '봄밤', '일상'],
  },
  {
    id: 'sample-scene-snowy-lodge',
    title: '눈 덮인 산장',
    description: '폭설로 고립된 산장, 낯선 사람과 단 둘이 밤을 보내게 된 이야기.',
    setting: '고산지대 산장. 폭설로 도로가 막혀 내려갈 수 없는 상황. 산장 내부에는 벽난로만이 타오르고, 창밖은 눈보라가 휘몰아친다. 통신도 끊겼고, 남아 있는 사람은 당신과 나 단 둘뿐이다.',
    mood: '고요하고 신비로운',
    openingLine: '도로가 완전히 막혔대요. 내일 아침까지는 내려갈 수 없을 것 같고... 낯선 분이랑 이런 상황이 되어서 당황스럽겠지만, 일단 난롯가에 앉아요. 따뜻한 게 필요할 거예요.',
    genre: '미스터리/로맨스',
    tags: ['미스터리', '로맨스', '산장', '폭설', '고립'],
  },
  {
    id: 'sample-scene-deep-sea-lab',
    title: '심해 연구소',
    description: '수심 3000m 심해 연구소, 미지의 생명체와 조우 직전의 긴박한 순간.',
    setting: '수심 3000미터 해저 연구소. 두꺼운 유리 너머로 칠흑 같은 심해가 펼쳐져 있고, 간헐적으로 발광 생물체가 지나간다. 갑자기 경보음이 울리고 모니터에 미확인 생체 신호가 잡혔다. 연구팀 중 지금 깨어 있는 건 당신과 나뿐이다.',
    mood: '불안하고 경이로운',
    openingLine: '지금 봤어? 센서에 잡힌 거. 크기가... 우리가 관측한 것 중 가장 커. 두렵긴 한데 — 이런 걸 발견하러 여기까지 온 거잖아. 어떻게 할 거야?',
    genre: 'SF/스릴러',
    tags: ['SF', '스릴러', '심해', '연구소', '미지의생명체'],
  },
  {
    id: 'sample-scene-jazz-bar',
    title: '밤의 재즈 바',
    description: '오래된 재즈 바에서 우연히 재회한 두 사람의 감미롭고 그리운 밤.',
    setting: '도심 골목에 숨은 오래된 재즈 바. 라이브 연주가 흐르는 가운데, 낮은 조명 아래 위스키 잔이 빛난다. 당신은 혼자 자리에 앉아 음악을 듣고 있었고, 오래전 알던 얼굴이 문을 열고 들어왔다. 서로 눈이 마주쳤다.',
    mood: '감미롭고 그리운',
    openingLine: '...오랜만이다. 여기서 마주칠 줄은 몰랐어. 앉아도 될까? 아니면 내가 없는 척해줄까, 네가 원한다면.',
    genre: '일상/로맨스',
    tags: ['로맨스', '일상', '재즈', '재회', '감성'],
  },
  {
    id: 'sample-scene-ruined-kingdom',
    title: '폐허가 된 왕국의 성',
    description: '전쟁으로 폐허가 된 왕국의 성, 마지막 기사와 함께하는 탈출 여정의 시작.',
    setting: '한때 번성했던 왕국의 성. 전쟁이 끝난 지 10년, 성벽은 무너지고 잡초가 무성하다. 달빛 아래 홀로 서 있는 기사 하나, 손에는 낡은 왕가의 문서를 쥐고 있다. 멀리서 적의 기마대 소리가 들려온다.',
    mood: '웅장하고 쓸쓸한',
    openingLine: '이 성을 기억하는 자가 아직 있었군. 당신이 찾는 것이 무엇인지는 모르나, 지금 이 땅은 위험하오. 함께 움직인다면 살아남을 가능성이 높아질 것이오 — 결정하시오.',
    genre: '판타지/어드벤처',
    tags: ['판타지', '어드벤처', '왕국', '기사', '폐허'],
  },
];

export async function seedSampleScenes() {
  console.log('🎬 샘플 장면 시드 시작...');

  let created = 0;
  let skipped = 0;

  for (const scene of SAMPLE_SCENES) {
    try {
      const existing = await db
        .select({ id: personaUserScenes.id })
        .from(personaUserScenes)
        .where(eq(personaUserScenes.title, scene.title));

      if (existing.length > 0) {
        console.log(`⏭ 동일 제목 장면 존재로 건너뜀: ${scene.title}`);
        skipped++;
        continue;
      }

      await db.insert(personaUserScenes).values({
        id: scene.id,
        creatorId: SYSTEM_CREATOR_ID,
        title: scene.title,
        description: scene.description,
        setting: scene.setting,
        mood: scene.mood,
        openingLine: scene.openingLine,
        genre: scene.genre,
        tags: scene.tags,
        isPublic: true,
        useCount: 0,
      });

      console.log(`✅ 샘플 장면 생성: ${scene.title}`);
      created++;
    } catch (err) {
      console.error(`❌ 샘플 장면 생성 실패 (${scene.title}):`, err);
    }
  }

  console.log(`📊 샘플 장면 시드 완료: ${created}개 생성, ${skipped}개 건너뜀`);
}
