# Apple Game Counter.

`https://www.gamesaien.com/game/fruit_box_a/` 에서 현재 보드의 합계와 숫자별 개수를 실시간으로 표시하는 크롬 확장프로그램입니다.

## 구성

- `manifest.json`: MV3 확장 설정
- `content-script.js`: 오버레이 UI 렌더링, 페이지 브리지 주입
- `content.css`: 우측 상단 고정 패널 스타일
- `page-bridge.js`: 페이지 런타임에서 보드 숫자 수집 및 집계

## 동작 방식

크롬 콘텐츠 스크립트는 페이지 자바스크립트 컨텍스트와 분리되어 있으므로, 실제 게임 런타임(`createjs`, 전역 게임 객체 등) 접근은 `page-bridge.js`를 페이지에 주입하는 방식으로 처리합니다.

수집 우선순위는 다음과 같습니다.

1. 전역 게임 객체/배열에서 보드 숫자 후보 탐색
2. `createjs` display tree 안의 숫자 텍스트 탐색
3. 실패 시 상태 문구와 디버그 로그 표시
