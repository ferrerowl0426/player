from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

OUTPUT = r"C:\Users\user\Desktop\播放器\outputs\测试账号密码表.pdf"
FONT = "STSong-Light"
pdfmetrics.registerFont(UnicodeCIDFont(FONT))

styles = getSampleStyleSheet()
title = ParagraphStyle("TitleCN", parent=styles["Title"], fontName=FONT, fontSize=20, leading=28, alignment=TA_CENTER, textColor=colors.HexColor("#2f2940"), spaceAfter=5*mm)
subtitle = ParagraphStyle("SubtitleCN", parent=styles["Normal"], fontName=FONT, fontSize=10, leading=16, alignment=TA_CENTER, textColor=colors.HexColor("#66616f"), spaceAfter=7*mm)
section = ParagraphStyle("SectionCN", parent=styles["Heading2"], fontName=FONT, fontSize=13, leading=18, textColor=colors.HexColor("#534AB7"), spaceBefore=3*mm, spaceAfter=3*mm)
body = ParagraphStyle("BodyCN", parent=styles["Normal"], fontName=FONT, fontSize=9.2, leading=15, textColor=colors.HexColor("#333039"))
cell = ParagraphStyle("CellCN", parent=body, fontSize=8.1, leading=11.5)
cell_center = ParagraphStyle("CellCenterCN", parent=cell, alignment=TA_CENTER)
header = ParagraphStyle("HeaderCN", parent=cell, alignment=TA_CENTER, textColor=colors.white, fontSize=8.3, leading=12)

admins_teachers = [
    ["超级管理员", "admin", "admin", "admin", "demo123", "启用"],
    ["普通教导主任", "13900000002", "dean_yuhan", "教务雨涵老师", "demo123", "启用"],
    ["老师", "13900000011", "teacher_luxiang", "鲁祥老师", "demo123", "启用"],
    ["老师", "13900000012", "teacher_yuanyuan", "缘缘老师", "demo123", "启用"],
    ["老师", "13900000013", "teacher_zhangning", "张宁老师", "demo123", "启用"],
]
students = [
    ["能学慧内部测试班", "13776186160", "internal_student_yuhan", "学生雨涵", "demo123", "启用"],
    ["能学慧内部测试班", "13013811119", "internal_student_luxiang", "学生鲁详", "demo123", "启用"],
    ["能学慧内部测试班", "18362776877", "internal_student_zhangning", "学生张宁", "demo123", "启用"],
    ["能学慧内部测试班", "13382800426", "internal_student_yuanyuan", "学生缘缘", "demo123", "启用"],
    ["测试一班", "13800001001", "test_student_01", "林知夏", "demo123", "启用"],
    ["测试一班", "13800001002", "test_student_02", "周予安", "demo123", "启用"],
    ["测试一班", "13800001003", "test_student_03", "沈嘉木", "demo123", "停用"],
    ["测试一班", "13800001004", "test_student_04", "顾星河", "demo123", "启用"],
    ["测试二班", "13800001005", "test_student_05", "许清禾", "demo123", "启用"],
    ["测试二班", "13800001006", "test_student_06", "江晚晴", "demo123", "启用"],
    ["测试二班", "13800001007", "test_student_07", "陆景行", "demo123", "启用"],
    ["测试二班", "13800001008", "test_student_08", "苏念安", "demo123", "停用"],
    ["测试三班", "13800001009", "test_student_09", "程一诺", "demo123", "启用"],
    ["测试三班", "13800001010", "test_student_10", "叶书言", "demo123", "启用"],
    ["测试三班", "13800001011", "test_student_11", "唐沐阳", "demo123", "启用"],
    ["测试三班", "13800001012", "test_student_12", "宋知遥", "demo123", "启用"],
    ["测试四班", "13800001013", "test_student_13", "白若溪", "demo123", "停用"],
    ["测试四班", "13800001014", "test_student_14", "韩子墨", "demo123", "启用"],
    ["测试四班", "13800001015", "test_student_15", "顾南乔", "demo123", "启用"],
    ["测试四班", "13800001016", "test_student_16", "秦以安", "demo123", "停用"],
]
permissions = [
    ["角色", "权限说明"],
    ["超级管理员", "系统自带最高权限账号。可管理教导主任、老师、班级、学员账号；可创建、编辑、删除曲目区、知识点区、图书馆资料、前置关系和附件；可给学生转班、启停账号、重置密码、编辑学生标记；不由 test-data 注入或清理。"],
    ["普通教导主任", "教务管理权限。可管理内容、班级、学生、老师分配、图书馆资料、作业推送与历史记录；可查看和维护全局教学数据。与超级管理员相比，不能操作系统自带超级管理员账号；教导主任账号管理以系统规则为准。"],
    ["老师", "教学执行权限。只能查看和管理自己负责班级的学员；可给负责学生推送作业，每次 1～5 个内容，覆盖合集、单曲/单知识点和分 P；可查看学生标记但不能编辑；不能新增/删除全局内容、班级或其他账号。"],
    ["学员", "学习查看权限。登录后查看自己的学习首页、被推送的视频/练习要求/提交要求和历史作业记录；不能管理内容、账号、班级或其他学生数据；停用学员不能作为正常可用账号参与新测试，但历史数据保留用于验证展示。"],
]

def P(text, style=cell):
    return Paragraph(str(text), style)

def make_table(rows, widths):
    converted = [[P(x, header) for x in rows[0]]] + [[P(x, cell_center if i in (1, 4, 5) else cell) for i, x in enumerate(row)] for row in rows[1:]]
    t = Table(converted, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#534AB7")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#FAF9FD"), colors.white]),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9D5E5")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t

def make_permissions_table(rows):
    converted = [[P(x, header) for x in rows[0]]] + [[P(row[0], cell_center), P(row[1], cell)] for row in rows[1:]]
    t = Table(converted, colWidths=[34*mm, 128*mm], repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#534AB7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#FAF9FD"), colors.white]),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9D5E5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor("#88838f"))
    canvas.drawString(18*mm, 12*mm, "能学慧吉他教室 · 测试账号速查")
    canvas.drawRightString(192*mm, 12*mm, f"第 {doc.page} 页")
    canvas.restoreState()

story = []
story.append(Paragraph("测试账号密码表", title))
story.append(Paragraph("能学慧吉他教室 · 测试账号与角色权限速查 · 密码统一为 demo123", subtitle))
story.append(Paragraph("登录说明", section))
story.append(Paragraph("教导主任、老师和学员正常使用手机号 / 纯数字账号登录；系统自带超级管理员使用 admin 登录。测试脚本内部标识仅用于 seed / clean 定位数据。", body))
story.append(Spacer(1, 3*mm))
story.append(Paragraph("内部测试提醒", section))
story.append(Paragraph("请大家帮忙重点测试老师布置作业、历史记录、学生学习首页、作业提交与查看等功能。当前阶段主要是熟悉功能和发现问题，请不要一次性上传太多正式文件；正式上线前会清空全部测试数据重新开始。", body))
story.append(Spacer(1, 4*mm))
story.append(Paragraph("教导主任 / 老师账号", section))
rows1 = [["角色", "登录账号", "内部标识", "昵称", "密码", "状态"]] + admins_teachers
story.append(make_table(rows1, [28*mm, 34*mm, 34*mm, 34*mm, 20*mm, 16*mm]))
story.append(Spacer(1, 6*mm))
story.append(Paragraph("学员账号", section))
rows2 = [["班级", "登录账号", "内部标识", "昵称", "密码", "状态"]] + students
story.append(make_table(rows2, [25*mm, 33*mm, 36*mm, 34*mm, 20*mm, 16*mm]))
story.append(PageBreak())
story.append(Paragraph("角色权限说明", title))
story.append(make_permissions_table(permissions))
story.append(Spacer(1, 7*mm))
story.append(Paragraph("测试说明", section))
for text in [
    "普通教导主任、老师和学员测试账号由 test-data/seed.mjs 创建；执行 test-data/clean.mjs 后会按 manifest.json 精确删除。",
    "系统自带超级管理员由业务初始化流程创建，不属于测试数据；clean.mjs 不会删除该账号。",
    "常规测试数据包含 4 个测试班级，每班 4 名学员；另有 1 个能学慧内部测试班，包含 4 名内部测试学员。",
    "请勿将本表公开发布；测试结束后建议执行清理脚本并删除本地 PDF。",
]:
    story.append(Paragraph("• " + text, body))

doc = SimpleDocTemplate(OUTPUT, pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=16*mm, bottomMargin=20*mm, title="测试账号密码表", author="能学慧吉他教室")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUTPUT)
