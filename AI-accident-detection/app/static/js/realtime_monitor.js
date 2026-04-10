let realtimeMonitorMap = null;
let realtimeMonitorInfoWindow = null;
let realtimeMonitorMarkers = [];
let realtimeMarkerCluster = null;
let realtimeRoutePolyline = null;

let ALL_MAP_POINTS = [];
let ALL_RISK_LIST = [];

let CURRENT_RISK_FILTER = "all";
let CURRENT_USER_POSITION = null;
let CURRENT_RADIUS_KM = 3;
let CURRENT_SORT_TYPE = "priority_desc";
let CURRENT_TIME_FILTER = "24h";

let CURRENT_ROUTE_ACTIVE = false;
let CURRENT_ROUTE_POINTS = [];
let CURRENT_ROUTE_RADIUS_KM = 0.5;

let CURRENT_VISIBLE_DAYS = 180;
let HAS_INITIAL_MAP_FIT = false;

let ORIGIN_AUTOCOMPLETE = null;
let DESTINATION_AUTOCOMPLETE = null;
let SELECTED_ORIGIN_PLACE = null;
let SELECTED_DESTINATION_PLACE = null;
let ROUTE_AUTOCOMPLETE_AVAILABLE = false;

function showLoading(text = "데이터 불러오는 중...") {
    const overlay = document.getElementById("global-loading-overlay");
    const textEl = document.getElementById("loading-text");

    if (textEl) {
        textEl.textContent = text;
    }

    if (overlay) {
        overlay.classList.remove("hidden");
    }
}

function hideLoading() {
    const overlay = document.getElementById("global-loading-overlay");
    if (overlay) {
        overlay.classList.add("hidden");
    }
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            ...(options.headers || {})
        },
        ...options
    });

    let json = null;
    try {
        json = await response.json();
    } catch (e) {
        json = null;
    }

    if (!response.ok) {
        const message = json?.message || `HTTP ${response.status}`;
        throw new Error(message);
    }

    return json;
}

function buildApiUrl(baseUrl, params = {}) {
    const url = new URL(baseUrl, window.location.origin);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, value);
        }
    });

    return url.toString();
}

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

function getMarkerIconByRiskLevel(riskLevel) {
    switch (riskLevel) {
        case "긴급":
            return "http://maps.google.com/mapfiles/ms/icons/red-dot.png";
        case "위험":
            return "http://maps.google.com/mapfiles/ms/icons/orange-dot.png";
        case "주의":
        default:
            return "http://maps.google.com/mapfiles/ms/icons/yellow-dot.png";
    }
}

function getRiskPriority(riskLevel) {
    switch (riskLevel) {
        case "긴급":
            return 3;
        case "위험":
            return 2;
        case "주의":
            return 1;
        default:
            return 0;
    }
}

function parseConfidence(value) {
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
}

function parseDateValue(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function isWithinSelectedTime(createdAt) {
    if (CURRENT_TIME_FILTER === "all") {
        return true;
    }

    const createdTime = new Date(createdAt).getTime();
    if (Number.isNaN(createdTime)) {
        return false;
    }

    const now = Date.now();
    const diffMs = now - createdTime;

    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    switch (CURRENT_TIME_FILTER) {
        case "1h":
            return diffMs <= 1 * HOUR;
        case "6h":
            return diffMs <= 6 * HOUR;
        case "24h":
            return diffMs <= 24 * HOUR;
        case "7d":
            return diffMs <= 7 * DAY;
        default:
            return true;
    }
}

function sortRiskItems(items) {
    const copied = [...items];

    copied.sort((a, b) => {
        if (CURRENT_SORT_TYPE === "priority_desc") {
            const diff = Number(b.priority_score || 0) - Number(a.priority_score || 0);
            if (diff !== 0) return diff;

            const riskDiff = getRiskPriority(b.risk_level) - getRiskPriority(a.risk_level);
            if (riskDiff !== 0) return riskDiff;

            return parseDateValue(b.created_at) - parseDateValue(a.created_at);
        }

        if (CURRENT_SORT_TYPE === "confidence_desc") {
            const diff = parseConfidence(b.confidence) - parseConfidence(a.confidence);
            if (diff !== 0) return diff;

            const riskDiff = getRiskPriority(b.risk_level) - getRiskPriority(a.risk_level);
            if (riskDiff !== 0) return riskDiff;

            return parseDateValue(b.created_at) - parseDateValue(a.created_at);
        }

        if (CURRENT_SORT_TYPE === "latest") {
            const diff = parseDateValue(b.created_at) - parseDateValue(a.created_at);
            if (diff !== 0) return diff;

            const riskDiff = getRiskPriority(b.risk_level) - getRiskPriority(a.risk_level);
            if (riskDiff !== 0) return riskDiff;

            return parseConfidence(b.confidence) - parseConfidence(a.confidence);
        }

        const riskDiff = getRiskPriority(b.risk_level) - getRiskPriority(a.risk_level);
        if (riskDiff !== 0) return riskDiff;

        const confidenceDiff = parseConfidence(b.confidence) - parseConfidence(a.confidence);
        if (confidenceDiff !== 0) return confidenceDiff;

        return parseDateValue(b.created_at) - parseDateValue(a.created_at);
    });

    return copied;
}

function clearMarkers() {
    if (realtimeMarkerCluster) {
        realtimeMarkerCluster.clearMarkers();
        realtimeMarkerCluster = null;
    }

    realtimeMonitorMarkers.forEach((marker) => marker.setMap(null));
    realtimeMonitorMarkers = [];
}

function createMarkerCluster() {
    if (!window.markerClusterer || !window.markerClusterer.MarkerClusterer) {
        console.warn("MarkerClusterer 라이브러리를 찾지 못했습니다.");
        return;
    }

    if (!realtimeMonitorMap || !realtimeMonitorMarkers.length) {
        return;
    }

    realtimeMarkerCluster = new markerClusterer.MarkerClusterer({
        map: realtimeMonitorMap,
        markers: realtimeMonitorMarkers,
        renderer: {
            render({ count, position }) {
                const color =
                    count >= 20 ? "#dc2626" :
                    count >= 10 ? "#ea580c" :
                    "#2563eb";

                return new google.maps.Marker({
                    position,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        fillColor: color,
                        fillOpacity: 0.9,
                        strokeColor: "#ffffff",
                        strokeWeight: 2,
                        scale: Math.min(24, 14 + Math.floor(count / 2))
                    },
                    label: {
                        text: String(count),
                        color: "#ffffff",
                        fontSize: "12px",
                        fontWeight: "900"
                    },
                    zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count
                });
            }
        }
    });
}

function hideRouteSummary() {
    const panel = document.getElementById("route-risk-summary-panel");
    if (panel) {
        panel.classList.add("hidden");
    }
}

function showRouteSummary() {
    const panel = document.getElementById("route-risk-summary-panel");
    if (panel) {
        panel.classList.remove("hidden");
    }
}

function setRouteSummaryBadge(levelText, className) {
    const badge = document.getElementById("route-risk-overall-badge");
    if (!badge) return;

    badge.className = "route-risk-overall-badge";
    if (className) {
        badge.classList.add(className);
    }
    badge.textContent = levelText;
}

function updateRouteRiskSummary(items) {
    const totalEl = document.getElementById("route-summary-total-count");
    const emergencyEl = document.getElementById("route-summary-emergency-count");
    const dangerEl = document.getElementById("route-summary-danger-count");
    const warningEl = document.getElementById("route-summary-warning-count");
    const messageEl = document.getElementById("route-summary-message");

    if (!CURRENT_ROUTE_ACTIVE) {
        hideRouteSummary();
        return;
    }

    const counts = {
        emergency: 0,
        danger: 0,
        warning: 0
    };

    items.forEach((item) => {
        if (item.risk_level === "긴급") {
            counts.emergency += 1;
        } else if (item.risk_level === "위험") {
            counts.danger += 1;
        } else {
            counts.warning += 1;
        }
    });

    const totalCount = items.length;

    if (totalEl) totalEl.textContent = totalCount;
    if (emergencyEl) emergencyEl.textContent = counts.emergency;
    if (dangerEl) dangerEl.textContent = counts.danger;
    if (warningEl) warningEl.textContent = counts.warning;

    if (totalCount === 0) {
        setRouteSummaryBadge("안전", "safe");
        if (messageEl) {
            messageEl.textContent = "현재 선택한 경로 반경 내에서 위험 지점이 확인되지 않았습니다.";
        }
    } else if (counts.emergency >= 1) {
        setRouteSummaryBadge("매우 높음", "critical");
        if (messageEl) {
            messageEl.textContent = "긴급 위험이 포함된 경로입니다. 가능하면 우회하거나 각별한 주의 운전이 필요합니다.";
        }
    } else if (counts.danger >= 2 || totalCount >= 5) {
        setRouteSummaryBadge("높음", "danger");
        if (messageEl) {
            messageEl.textContent = "위험 지점이 다수 포함된 경로입니다. 감속 운전 및 전방 주시를 권장합니다.";
        }
    } else if (counts.danger >= 1 || counts.warning >= 2) {
        setRouteSummaryBadge("보통", "warning");
        if (messageEl) {
            messageEl.textContent = "일부 주의 구간이 포함되어 있습니다. 주변 상황을 확인하며 이동해주세요.";
        }
    } else {
        setRouteSummaryBadge("낮음", "normal");
        if (messageEl) {
            messageEl.textContent = "상대적으로 안정적인 경로지만 기본적인 안전 운전은 계속 유지해주세요.";
        }
    }

    showRouteSummary();
}

function clearRoute() {
    CURRENT_ROUTE_ACTIVE = false;
    CURRENT_ROUTE_POINTS = [];
    CURRENT_ROUTE_RADIUS_KM = 0.5;
    SELECTED_ORIGIN_PLACE = null;
    SELECTED_DESTINATION_PLACE = null;

    const originInput = document.getElementById("route-origin");
    const destinationInput = document.getElementById("route-destination");
    if (originInput) originInput.value = "";
    if (destinationInput) destinationInput.value = "";

    if (realtimeRoutePolyline) {
        realtimeRoutePolyline.setMap(null);
        realtimeRoutePolyline = null;
    }

    const title = document.getElementById("risk-list-title");
    const subtitle = document.getElementById("risk-list-subtitle");

    if (title) title.textContent = "실시간 위험 리스트";
    if (subtitle) subtitle.textContent = "최근 탐지된 위험 이벤트를 빠르게 확인할 수 있습니다.";

    hideRouteSummary();
}

function normalizeFileType(fileType) {
    return String(fileType || "").trim();
}

function buildPreviewMediaHtml(item) {
    const thumbnailPath = item.thumbnail_path || item.file_path || "";
    const fileType = normalizeFileType(item.file_type);

    if (!thumbnailPath) {
        return `
            <div style="
                width: 100%;
                height: 150px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #f3f4f6;
                color: #6b7280;
                font-size: 13px;
                border-radius: 10px;
                margin-bottom: 10px;
            ">
                미리보기 없음
            </div>
        `;
    }

    if (fileType === "이미지") {
        return `
            <img
                src="${escapeHtml(thumbnailPath)}"
                alt="위험 미리보기"
                style="
                    width: 100%;
                    height: 150px;
                    object-fit: cover;
                    border-radius: 10px;
                    display: block;
                    margin-bottom: 10px;
                    background: #f3f4f6;
                "
            >
        `;
    }

    if (fileType === "영상") {
        return `
            <video
                src="${escapeHtml(thumbnailPath)}"
                muted
                playsinline
                preload="metadata"
                style="
                    width: 100%;
                    height: 150px;
                    object-fit: cover;
                    border-radius: 10px;
                    display: block;
                    margin-bottom: 10px;
                    background: #111827;
                "
            ></video>
        `;
    }

    return `
        <div style="
            width: 100%;
            height: 150px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f3f4f6;
            color: #6b7280;
            font-size: 13px;
            border-radius: 10px;
            margin-bottom: 10px;
        ">
            미리보기 없음
        </div>
    `;
}

function buildInfoWindowContent(item) {
    return `
        <div class="map-info-window" style="width: 260px; padding: 4px 2px;">
            ${buildPreviewMediaHtml(item)}

            <div
                class="map-info-title"
                style="
                    font-weight: 700;
                    font-size: 14px;
                    color: #111827;
                    margin-bottom: 8px;
                    line-height: 1.4;
                "
            >
                ${escapeHtml(item.location_text || "위치 정보 없음")}
            </div>

            <div class="map-info-row" style="font-size: 13px; margin-bottom: 4px;">
                <strong>위험도:</strong> ${escapeHtml(item.risk_level || "-")}
            </div>
            <div class="map-info-row" style="font-size: 13px; margin-bottom: 4px;">
                <strong>탐지 객체:</strong> ${escapeHtml(item.detected_label || "-")}
            </div>
            <div class="map-info-row" style="font-size: 13px; margin-bottom: 4px;">
                <strong>신뢰도:</strong> ${escapeHtml(item.confidence ?? 0)}
            </div>
            <div class="map-priority-row">
                우선 처리 점수: ${escapeHtml(item.priority_score ?? 0)}점
            </div>

            <button type="button" class="map-detail-btn">
                상세 보기
            </button>
        </div>
    `;
}

function createRiskListItem(item) {
    const wrapper = document.createElement("div");
    wrapper.className = `risk-list-item risk-${item.risk_level || "주의"}`;
    wrapper.dataset.reportId = item.report_id;

    wrapper.innerHTML = `
        <div class="risk-list-top">
            <span class="risk-badge risk-${escapeHtml(item.risk_level || "주의")}">${escapeHtml(item.risk_level || "주의")}</span>
            <span class="risk-time">${escapeHtml(item.time_ago || "-")}</span>
        </div>

        <div class="risk-location">${escapeHtml(item.location_text || "위치 정보 없음")}</div>

        <div class="risk-meta">
            <span>장애물: ${escapeHtml(item.detected_label || "-")}</span>
            <span>상태: ${escapeHtml(item.status || "-")}</span>
        </div>

        <div class="risk-extra">
            <span>신고ID: ${escapeHtml(item.report_id)}</span>
            <span>신뢰도: ${escapeHtml(item.confidence ?? 0)}</span>
            <span class="priority-score-badge">우선 ${escapeHtml(item.priority_score ?? 0)}점</span>
        </div>
    `;

    wrapper.addEventListener("click", () => {
        const reportId = wrapper.dataset.reportId;
        if (reportId) {
            openRiskDetailModal(reportId);
        }
    });

    return wrapper;
}

function getFilteredMapPoints() {
    let items = [...ALL_MAP_POINTS];

    if (CURRENT_RISK_FILTER !== "all") {
        items = items.filter((item) => item.risk_level === CURRENT_RISK_FILTER);
    }

    items = items.filter((item) => isWithinSelectedTime(item.created_at));

    return sortRiskItems(items);
}

function getFilteredRiskList() {
    let items = [...ALL_RISK_LIST];

    if (CURRENT_RISK_FILTER !== "all") {
        items = items.filter((item) => item.risk_level === CURRENT_RISK_FILTER);
    }

    items = items.filter((item) => isWithinSelectedTime(item.created_at));

    return sortRiskItems(items);
}

function getTimeFilterLabel() {
    switch (CURRENT_TIME_FILTER) {
        case "1h":
            return "최근 1시간";
        case "6h":
            return "최근 6시간";
        case "24h":
            return "최근 24시간";
        case "7d":
            return "최근 7일";
        default:
            return "전체 기간";
    }
}

function updateFilterStatus() {
    const statusEl = document.getElementById("monitor-filter-status");
    if (!statusEl) return;

    const riskText = CURRENT_RISK_FILTER === "all" ? "전체 위험도" : `${CURRENT_RISK_FILTER}만`;
    const timeText = getTimeFilterLabel();

    statusEl.textContent = `${timeText} 기준으로 ${riskText} 데이터를 표시하고 있습니다.`;
}

function renderMapPoints(items, options = {}) {
    if (!realtimeMonitorMap) return;

    const preserveView = options.preserveView ?? true;
    const currentCenter = preserveView ? realtimeMonitorMap.getCenter() : null;
    const currentZoom = preserveView ? realtimeMonitorMap.getZoom() : null;

    clearMarkers();

    const bounds = new google.maps.LatLngBounds();
    let validCount = 0;

    items.forEach((item) => {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return;
        }

        const marker = new google.maps.Marker({
            position: { lat, lng },
            map: realtimeMonitorMap,
            title: item.location_text || "위치 정보 없음",
            icon: getMarkerIconByRiskLevel(item.risk_level)
        });

        marker.addListener("click", () => {
            if (!realtimeMonitorInfoWindow) {
                realtimeMonitorInfoWindow = new google.maps.InfoWindow();
            }

            realtimeMonitorInfoWindow.setContent(buildInfoWindowContent(item));
            realtimeMonitorInfoWindow.open({
                anchor: marker,
                map: realtimeMonitorMap
            });

            google.maps.event.addListenerOnce(realtimeMonitorInfoWindow, "domready", () => {
                const btn = document.querySelector(".map-detail-btn");
                if (btn) {
                    btn.addEventListener("click", () => openRiskDetailModal(item.report_id));
                }
            });
        });

        realtimeMonitorMarkers.push(marker);
        bounds.extend({ lat, lng });
        validCount += 1;
    });

    createMarkerCluster();

    if (CURRENT_USER_POSITION) {
        const userMarker = new google.maps.Marker({
            position: CURRENT_USER_POSITION,
            map: realtimeMonitorMap,
            title: "내 현재 위치",
            icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
        });

        realtimeMonitorMarkers.push(userMarker);
        bounds.extend(CURRENT_USER_POSITION);
        validCount += 1;
    }

    if (validCount === 0) {
        return;
    }

    if (!HAS_INITIAL_MAP_FIT) {
        realtimeMonitorMap.fitBounds(bounds);

        const listener = google.maps.event.addListener(realtimeMonitorMap, "idle", function () {
            if (realtimeMonitorMap.getZoom() > 15) {
                realtimeMonitorMap.setZoom(15);
            }
            google.maps.event.removeListener(listener);
        });

        HAS_INITIAL_MAP_FIT = true;
        return;
    }

    if (preserveView && currentCenter && currentZoom) {
        realtimeMonitorMap.setCenter(currentCenter);
        realtimeMonitorMap.setZoom(currentZoom);
    }
}

function renderRiskList(items) {
    const listContainer = document.getElementById("realtime-risk-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    if (items.length === 0) {
        listContainer.innerHTML = `
            <div class="risk-empty-state">
                현재 조건에 맞는 위험 데이터가 없습니다.
            </div>
        `;
        return;
    }

    items.forEach((item) => {
        listContainer.appendChild(createRiskListItem(item));
    });
}

function applyFiltersAndRender(options = {}) {
    const filteredMapPoints = getFilteredMapPoints();
    const filteredRiskList = getFilteredRiskList();

    renderMapPoints(filteredMapPoints, options);
    renderRiskList(filteredRiskList);
    updateFilterStatus();

    if (CURRENT_ROUTE_ACTIVE) {
        updateRouteRiskSummary(filteredRiskList);
    } else {
        hideRouteSummary();
    }
}

async function loadMapPoints() {
    if (!window.REALTIME_MONITOR_CONFIG) return;

    const url = buildApiUrl(window.REALTIME_MONITOR_CONFIG.mapPointsApiUrl, {
        days: CURRENT_VISIBLE_DAYS,
        limit: 300
    });

    const result = await fetchJson(url);
    if (!result.success) return;

    ALL_MAP_POINTS = result.items || [];
}

async function loadSummaryCards() {
    if (!window.REALTIME_MONITOR_CONFIG) return;

    const url = buildApiUrl(window.REALTIME_MONITOR_CONFIG.summaryApiUrl, {
        days: CURRENT_VISIBLE_DAYS
    });

    const result = await fetchJson(url);
    if (!result.success) return;

    const data = result.data || {};

    const currentRiskZones = document.getElementById("summary-current-risk-zones");
    const todayReports = document.getElementById("summary-today-reports");
    const emergencyLast24h = document.getElementById("summary-emergency-last-24h");
    const hotspots = document.getElementById("summary-hotspots");

    if (currentRiskZones) currentRiskZones.textContent = data.current_risk_zones ?? 0;
    if (todayReports) todayReports.textContent = data.today_reports ?? 0;
    if (emergencyLast24h) emergencyLast24h.textContent = data.emergency_last_24h ?? 0;
    if (hotspots) hotspots.textContent = data.hotspots ?? 0;
}

async function loadRiskList() {
    if (!window.REALTIME_MONITOR_CONFIG) return;

    const url = buildApiUrl(window.REALTIME_MONITOR_CONFIG.riskListApiUrl, {
        days: CURRENT_VISIBLE_DAYS,
        limit: 50
    });

    const result = await fetchJson(url);
    if (!result.success) return;

    ALL_RISK_LIST = result.items || [];
}

async function refreshRealtimeMonitorData(options = {}) {
    const preserveView = options.preserveView ?? true;
    const showOverlay = options.showOverlay ?? true;

    try {
        if (showOverlay) {
            showLoading("데이터 불러오는 중...");
        }

        await Promise.all([
            loadSummaryCards(),
            loadMapPoints(),
            loadRiskList()
        ]);

        applyFiltersAndRender({ preserveView });
    } catch (error) {
        console.error("탐지 현황 데이터 갱신 실패:", error);
    } finally {
        if (showOverlay) {
            hideLoading();
        }
    }
}

function bindRiskFilterButtons() {
    const buttons = document.querySelectorAll(".filter-btn[data-risk-filter]");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            CURRENT_RISK_FILTER = btn.dataset.riskFilter || "all";
            applyFiltersAndRender({ preserveView: true });
        });
    });
}

function bindRadiusSelect() {
    const radiusSelect = document.getElementById("nearby-radius-select");
    if (!radiusSelect) return;

    radiusSelect.addEventListener("change", () => {
        CURRENT_RADIUS_KM = Number(radiusSelect.value || 3);

        if (CURRENT_USER_POSITION) {
            applyFiltersAndRender({ preserveView: true });
        }
    });
}

function bindSortSelect() {
    const sortSelect = document.getElementById("risk-sort-select");
    if (!sortSelect) return;

    sortSelect.addEventListener("change", () => {
        CURRENT_SORT_TYPE = sortSelect.value || "priority_desc";
        applyFiltersAndRender({ preserveView: true });
    });
}

function bindTimeFilterSelect() {
    const timeSelect = document.getElementById("recent-time-filter");
    if (!timeSelect) return;

    timeSelect.addEventListener("change", () => {
        CURRENT_TIME_FILTER = timeSelect.value || "24h";
        applyFiltersAndRender({ preserveView: true });
    });
}

function bindNearbyButtons() {
    const findBtn = document.getElementById("find-nearby-risk-btn");
    const resetBtn = document.getElementById("reset-nearby-risk-btn");

    if (findBtn) {
        findBtn.addEventListener("click", () => {
            alert("현재 위치 기반 기능은 이후 확장용입니다. 지금은 전체 보기, 위험도 필터, 경로 위험 보기를 중심으로 확인해주세요.");
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            CURRENT_USER_POSITION = null;
            applyFiltersAndRender({ preserveView: true });
        });
    }
}

function initRouteAutocomplete() {
    const originInput = document.getElementById("route-origin");
    const destinationInput = document.getElementById("route-destination");

    if (!window.google || !google.maps || !google.maps.places) {
        ROUTE_AUTOCOMPLETE_AVAILABLE = false;
        return;
    }

    if (!originInput || !destinationInput) return;

    ORIGIN_AUTOCOMPLETE = new google.maps.places.Autocomplete(originInput, {
        fields: ["formatted_address", "geometry", "name"]
    });

    DESTINATION_AUTOCOMPLETE = new google.maps.places.Autocomplete(destinationInput, {
        fields: ["formatted_address", "geometry", "name"]
    });

    ORIGIN_AUTOCOMPLETE.addListener("place_changed", () => {
        SELECTED_ORIGIN_PLACE = ORIGIN_AUTOCOMPLETE.getPlace();
    });

    DESTINATION_AUTOCOMPLETE.addListener("place_changed", () => {
        SELECTED_DESTINATION_PLACE = DESTINATION_AUTOCOMPLETE.getPlace();
    });

    ROUTE_AUTOCOMPLETE_AVAILABLE = true;
}

function updateKakaoRouteMeta(distanceM, durationS) {
    const subtitle = document.getElementById("risk-list-subtitle");
    if (!subtitle) return;

    const distanceKm = distanceM ? (Number(distanceM) / 1000).toFixed(1) : "-";
    const durationMin = durationS ? Math.round(Number(durationS) / 60) : "-";

    subtitle.textContent = `선택한 경로 기준 위험 지점을 분석 중입니다. 예상 거리 ${distanceKm}km / 소요 ${durationMin}분`;
}

async function requestKakaoRoute(originPlace, destinationPlace) {
    const originLat = originPlace.geometry.location.lat();
    const originLng = originPlace.geometry.location.lng();
    const destLat = destinationPlace.geometry.location.lat();
    const destLng = destinationPlace.geometry.location.lng();

    const url = new URL(window.REALTIME_MONITOR_CONFIG.kakaoRouteApiUrl, window.location.origin);
    url.searchParams.set("origin_lat", originLat);
    url.searchParams.set("origin_lng", originLng);
    url.searchParams.set("dest_lat", destLat);
    url.searchParams.set("dest_lng", destLng);

    const result = await fetchJson(url.toString());
    return result.data || result;
}

function drawRoutePolyline(path) {
    if (!realtimeMonitorMap || !Array.isArray(path) || path.length < 2) return;

    if (realtimeRoutePolyline) {
        realtimeRoutePolyline.setMap(null);
        realtimeRoutePolyline = null;
    }

    realtimeRoutePolyline = new google.maps.Polyline({
        path: path,
        map: realtimeMonitorMap,
        strokeColor: "#3b82f6",
        strokeOpacity: 0.95,
        strokeWeight: 5
    });
}

function bindRouteRiskButtons() {
    const findBtn = document.getElementById("find-route-risk-btn");
    const resetBtn = document.getElementById("reset-route-risk-btn");
    const radiusSelect = document.getElementById("route-risk-radius");

    if (findBtn) {
        findBtn.addEventListener("click", async () => {
            if (!ROUTE_AUTOCOMPLETE_AVAILABLE) {
                alert("장소 자동완성 기능을 사용할 수 없습니다.");
                return;
            }

            if (!SELECTED_ORIGIN_PLACE || !SELECTED_DESTINATION_PLACE) {
                alert("출발지와 도착지를 자동완성 목록에서 선택해주세요.");
                return;
            }

            try {
                showLoading("경로 위험 분석 중...");

                CURRENT_ROUTE_RADIUS_KM = Number(radiusSelect?.value || 0.5);

                const routeData = await requestKakaoRoute(
                    SELECTED_ORIGIN_PLACE,
                    SELECTED_DESTINATION_PLACE
                );

                const path = routeData.path || routeData.routes?.[0]?.path || [];

                if (!Array.isArray(path) || path.length < 2) {
                    throw new Error("유효한 경로 좌표가 없습니다.");
                }

                CURRENT_ROUTE_ACTIVE = true;
                CURRENT_ROUTE_POINTS = path;

                drawRoutePolyline(path);
                updateKakaoRouteMeta(routeData.distance_m, routeData.duration_s);
                applyFiltersAndRender({ preserveView: true });
            } catch (error) {
                console.error("[KakaoRoute] 실패:", error);
                alert(error.message || "카카오 길찾기 조회 중 오류가 발생했습니다.");
            } finally {
                hideLoading();
            }
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            clearRoute();
            applyFiltersAndRender({ preserveView: true });
        });
    }
}

function getRiskDetailElements() {
    return {
        modal: document.getElementById("risk-detail-modal"),
        backdrop: document.getElementById("risk-detail-backdrop"),
        closeBtn: document.getElementById("risk-detail-close"),

        badge: document.getElementById("risk-detail-badge"),
        timeago: document.getElementById("risk-detail-timeago"),
        title: document.getElementById("risk-detail-title"),
        location: document.getElementById("risk-detail-location"),
        content: document.getElementById("risk-detail-content"),

        reportId: document.getElementById("risk-detail-report-id"),
        detectedLabel: document.getElementById("risk-detail-detected-label"),
        confidence: document.getElementById("risk-detail-confidence"),
        priorityScore: document.getElementById("risk-detail-priority-score"),
        status: document.getElementById("risk-detail-status"),
        reportType: document.getElementById("risk-detail-report-type"),
        createdAt: document.getElementById("risk-detail-created-at"),
        fileType: document.getElementById("risk-detail-file-type"),
        originalName: document.getElementById("risk-detail-original-name"),

        image: document.getElementById("risk-detail-image"),
        imageEmpty: document.getElementById("risk-detail-image-empty")
    };
}

function openModal() {
    const { modal } = getRiskDetailElements();
    if (!modal) return;

    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeModal() {
    const { modal } = getRiskDetailElements();
    if (!modal) return;

    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

function setBadgeStyle(element, riskLevel) {
    if (!element) return;

    element.className = "risk-detail-badge";

    if (riskLevel === "긴급") {
        element.classList.add("emergency");
    } else if (riskLevel === "위험") {
        element.classList.add("danger");
    } else {
        element.classList.add("warning");
    }

    element.textContent = riskLevel || "주의";
}

function renderRiskDetail(detail) {
    const els = getRiskDetailElements();

    setBadgeStyle(els.badge, detail.risk_level);
    if (els.timeago) els.timeago.textContent = detail.time_ago || "-";
    if (els.title) els.title.textContent = detail.title || "제목 없음";
    if (els.location) els.location.textContent = detail.location_text || "위치 정보 없음";
    if (els.content) els.content.textContent = detail.content || "상세 내용 없음";

    if (els.reportId) els.reportId.textContent = detail.report_id ?? "-";
    if (els.detectedLabel) els.detectedLabel.textContent = detail.detected_label || "-";
    if (els.confidence) els.confidence.textContent = detail.confidence ?? "-";
    if (els.priorityScore) els.priorityScore.textContent = detail.priority_score ?? "-";
    if (els.status) els.status.textContent = detail.status || "-";
    if (els.reportType) els.reportType.textContent = detail.report_type || "-";
    if (els.createdAt) els.createdAt.textContent = detail.created_at || "-";
    if (els.fileType) els.fileType.textContent = detail.file_type || "-";
    if (els.originalName) els.originalName.textContent = detail.original_name || "-";

    if (els.image && els.imageEmpty) {
        if (detail.file_path && detail.file_type === "이미지") {
            els.image.src = detail.file_path;
            els.image.style.display = "block";
            els.imageEmpty.style.display = "none";
        } else {
            els.image.src = "";
            els.image.style.display = "none";
            els.imageEmpty.style.display = "flex";
        }
    }
}

async function openRiskDetailModal(reportId) {
    if (!window.REALTIME_MONITOR_CONFIG || !reportId) return;

    try {
        showLoading("상세 정보 불러오는 중...");

        const url = `${window.REALTIME_MONITOR_CONFIG.detailApiBaseUrl}/${reportId}`;
        const result = await fetchJson(url);

        if (!result.success) {
            alert(result.message || "상세 정보를 불러오지 못했습니다.");
            return;
        }

        renderRiskDetail(result.data);
        openModal();
    } catch (error) {
        console.error("상세 정보 조회 실패:", error);
        alert("상세 정보를 불러오는 중 오류가 발생했습니다.");
    } finally {
        hideLoading();
    }
}

function bindRiskDetailModalEvents() {
    const { backdrop, closeBtn, modal } = getRiskDetailElements();

    if (backdrop) {
        backdrop.addEventListener("click", closeModal);
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", closeModal);
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
            closeModal();
        }
    });
}

function initRealtimeMonitorMap() {
    const mapElement = document.getElementById("realtime-monitor-map");
    if (!mapElement) return;

    realtimeMonitorMap = new google.maps.Map(mapElement, {
        center: { lat: 37.5665, lng: 126.9780 },
        zoom: 11,
        mapTypeControl: true,
        fullscreenControl: true,
        streetViewControl: false
    });

    realtimeMonitorInfoWindow = new google.maps.InfoWindow();

    initRouteAutocomplete();

    refreshRealtimeMonitorData({
        preserveView: false,
        showOverlay: true
    });

    setInterval(() => {
        refreshRealtimeMonitorData({
            preserveView: true,
            showOverlay: false
        });
    }, 30000);
}

document.addEventListener("DOMContentLoaded", () => {
    const container = document.querySelector(".monitor-container");
    const configuredDays = Number(container?.dataset?.realtimeVisibleDays || 180);
    CURRENT_VISIBLE_DAYS = Number.isNaN(configuredDays) ? 180 : configuredDays;

    bindRiskFilterButtons();
    bindRadiusSelect();
    bindSortSelect();
    bindTimeFilterSelect();
    bindNearbyButtons();
    bindRouteRiskButtons();
    bindRiskDetailModalEvents();
    updateFilterStatus();
    hideRouteSummary();
});

window.initRealtimeMonitorMap = initRealtimeMonitorMap;