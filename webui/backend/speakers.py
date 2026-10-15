"""Open labels with stable identities; the two special tracks keep their semantics."""
import re

from .errors import Problem


def validate_speakers(speakers, previous=None):
    ids, labels = set(), set()
    for index, speaker in enumerate(speakers):
        field = f"speakers.{index}"
        if not speaker.id.strip() or speaker.id in ids:
            raise Problem("说话人身份为空或重复", field=field + ".id")
        if not speaker.label.strip() or speaker.label != speaker.label.strip():
            raise Problem("说话人名称为空或含首尾空白", field=field + ".label")
        if speaker.label in labels:
            raise Problem("说话人名称已存在，请使用明确的合并说话人操作", field=field + ".label")
        if speaker.order != index:
            raise Problem("说话人顺序须从零连续编号", field=field + ".order")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", speaker.color):
            raise Problem("说话人颜色须为六位十六进制颜色", field=field + ".color")
        ids.add(speaker.id)
        labels.add(speaker.label)
    if [s.label for s in speakers[-2:]] != ["?", "NONSPEECH"]:
        raise Problem("未标注 ? 与非对白 NONSPEECH 须保留在底部", field="speakers")
    if previous is not None:
        for special in ("?", "NONSPEECH"):
            old = next(s for s in previous if s.label == special)
            new = next(s for s in speakers if s.label == special)
            if old.id != new.id:
                raise Problem("特殊说话人身份及语义不可更改", field="speakers")
