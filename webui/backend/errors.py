class Problem(Exception):
    def __init__(self, message, *, status=422, field=None, entry=None, code="invalid_input"):
        self.status = status
        self.detail = {"code": code, "message": message, "field": field, "entry": entry}
        super().__init__(message)
