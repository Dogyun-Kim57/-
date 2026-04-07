## Table: users
### Columns:
```
id bigint AI PK 
username varchar(50) 
email varchar(100) 
password_hash varchar(255) 
name varchar(50) 
role enum('user','admin') 
created_at datetime 
updated_at datetime 
deleted_at datetime
```
---

## Table: role_requests
### Columns:
```
id bigint AI PK 
user_id bigint 
request_reason text 
status enum('대기','승인','거절') 
reviewed_by bigint 
reviewed_at datetime 
created_at datetime
```
---

## Table: reports
### Columns:
```
id bigint AI PK 
user_id bigint 
title varchar(200) 
content text 
report_type enum('이미지','영상','카메라') 
location_text varchar(255) 
latitude decimal(10,7) 
longitude decimal(10,7) 
risk_level enum('낮음','주의','위험','긴급') 
status enum('접수','확인중','처리완료','오탐') 
created_at datetime 
updated_at datetime 
deleted_at datetime
```
---

### Table: report_status_logs
## Columns:
```
id bigint AI PK 
report_id bigint 
old_status enum('접수','확인중','처리완료','오탐') 
new_status enum('접수','확인중','처리완료','오탐') 
changed_by bigint 
memo varchar(255) 
created_at datetime
```
---

## Table: report_files
### Columns:
```
id bigint AI PK 
report_id bigint 
original_name varchar(255) 
stored_name varchar(255) 
file_path varchar(500) 
file_type enum('이미지','영상') 
file_size bigint 
is_active tinyint(1) 
uploaded_at datetime 
updated_at datetime 
deleted_at datetime
```
---

## Table: detections
### Columns:
```
id bigint AI PK 
report_id bigint 
file_id bigint 
detected_label varchar(100) 
confidence decimal(5,2) 
bbox_x1 int 
bbox_y1 int 
bbox_x2 int 
bbox_y2 int 
detected_at datetime 
created_at datetime 
frame_no int 
time_sec decimal(10,2) 
frame_width int 
frame_height int
```
---

## Table: board_posts
### Columns:
```
id bigint AI PK 
user_id bigint 
title varchar(200) 
content text 
view_count int 
is_notice tinyint(1) 
is_hidden tinyint(1) 
created_at datetime 
updated_at datetime 
deleted_at datetime
```
---

## Table: board_files
### Columns:
```
id bigint AI PK 
post_id bigint 
original_name varchar(255) 
stored_name varchar(255) 
file_path varchar(500) 
file_type enum('이미지','영상') 
file_size bigint 
is_active tinyint(1) 
created_at datetime 
updated_at datetime 
deleted_at datetime
```
---

## Table: board_comments
### Columns:
```
id bigint AI PK 
post_id bigint 
user_id bigint 
parent_id bigint 
content text 
depth tinyint 
is_hidden tinyint(1) 
created_at datetime 
updated_at datetime 
deleted_at datetime
```
---

## Table: alerts
### Columns:
```
id bigint AI PK 
report_id bigint 
detection_id bigint 
alert_level enum('낮음','주의','위험','긴급') 
message varchar(255) 
is_read tinyint(1) 
created_at datetime 
read_at datetime
```
---

## Table: alembic_version
### Columns:
```
version_num varchar(32) PK
```
---

## Table: ai_compare_runs
### Columns:
```
id bigint AI PK 
report_id bigint 
file_id bigint 
requested_by bigint 
source_type enum('이미지','영상') 
compare_mode enum('image','video') 
sample_fps decimal(4,2) 
total_sampled_frames int 
status enum('대기','진행중','완료','실패') 
created_at datetime 
started_at datetime 
finished_at datetime
```
---

## Table: ai_compare_results
### Columns:
```
id bigint AI PK 
compare_run_id bigint 
model_name varchar(100) 
optimizer_name varchar(50) 
model_version varchar(100) 
total_detections int 
detected_frame_count int 
avg_confidence decimal(5,4) 
max_confidence decimal(5,4) 
processing_time decimal(10,4) 
best_frame_no int 
best_time_sec decimal(10,2) 
best_detection_count int 
best_avg_confidence decimal(5,4) 
best_max_confidence decimal(5,4) 
result_image_path varchar(500) 
result_json json 
status enum('대기','완료','실패') 
error_message varchar(255) 
created_at datetime
```
---

## Table: admin_logs
### Columns:
```
id bigint AI PK 
admin_user_id bigint 
action_type varchar(100) 
target_type varchar(100) 
target_id bigint 
action_detail varchar(255) 
created_at datetime
```
---