from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from finance.views import HealthView
from finance.student_session import StudentSessionView
urlpatterns = [
    path("health/", HealthView.as_view()),
    path("admin/", admin.site.urls),
    path("api/auth/session/", StudentSessionView.as_view(), name="student-session"),
    path("api/auth/", include("rest_framework.urls")),
    path("api/v2/", include("finance.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
]
